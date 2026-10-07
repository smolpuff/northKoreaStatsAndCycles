import { randomBytes } from "node:crypto";
import { defineConfig, loadEnv, type Plugin } from "vite";

let projectEnvironment: Record<string, string> = {};
const completedTwitchAuthorizations = new Map<
  string,
  { accessToken: string; clientId: string; expiresAt: number }
>();

function readLocalTwitchCredentials() {
  const values = { ...projectEnvironment, ...process.env };
  return {
    clientId: values.TWITCH_APP_CLIENT_ID || "",
    clientSecret: values.TWITCH_APP_CLIENT_SECRET || "",
  };
}

function twitchOAuthPlugin(): Plugin {
  return {
    name: "twitch-oauth",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(
          req.url ?? "/",
          `http://${req.headers.host ?? "localhost:8080"}`,
        );

        if (requestUrl.pathname === "/api/public/auth/twitch/start") {
          const { clientId } = readLocalTwitchCredentials();
          if (!clientId) {
            res.statusCode = 500;
            res.end("Twitch OAuth not configured");
            return;
          }

          const redirectUri = `${requestUrl.origin}/api/public/auth/twitch/callback`;
          const nextParam = requestUrl.searchParams.get("next") || "/";
          const desktopId = requestUrl.searchParams.get("desktop") || "";
          const state = randomBytes(16).toString("hex");
          const payload = `${state}:${encodeURIComponent(nextParam)}:${encodeURIComponent(desktopId)}`;
          const authUrl = new URL("https://id.twitch.tv/oauth2/authorize");
          authUrl.searchParams.set("client_id", clientId);
          authUrl.searchParams.set("redirect_uri", redirectUri);
          authUrl.searchParams.set("response_type", "code");
          authUrl.searchParams.set(
            "scope",
            "user:read:email user:read:chat user:write:chat channel:manage:polls",
          );
          authUrl.searchParams.set("state", state);
          authUrl.searchParams.set("force_verify", "true");

          res.statusCode = 302;
          res.setHeader("Location", authUrl.toString());
          res.setHeader(
            "Set-Cookie",
            `tw_oauth=${payload}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
          );
          res.end();
          return;
        }

        if (requestUrl.pathname === "/api/public/auth/twitch/callback") {
          const { clientId, clientSecret } = readLocalTwitchCredentials();
          if (!clientId || !clientSecret) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(
              '<!doctype html><meta charset="utf-8"><title>Twitch sign-in</title><body style="font-family:system-ui;background:#0b0b12;color:#eee;padding:2rem"><h1>Twitch sign-in</h1><p>Twitch OAuth not configured.</p></body>',
            );
            return;
          }

          const code = requestUrl.searchParams.get("code");
          const state = requestUrl.searchParams.get("state");
          if (!code || !state) {
            res.statusCode = 400;
            res.end("Missing code/state.");
            return;
          }

          const cookie = Object.fromEntries(
            (req.headers.cookie || "").split(";").map((c) => {
              const [k, ...v] = c.trim().split("=");
              return [k, v.join("=")];
            }),
          );
          const raw = cookie["tw_oauth"];
          if (!raw) {
            res.statusCode = 400;
            res.end("Missing OAuth state cookie. Try again.");
            return;
          }
          const [expectedState, nextEnc, desktopEnc] = raw.split(":");
          if (expectedState !== state) {
            res.statusCode = 400;
            res.end("State mismatch. Try again.");
            return;
          }
          const next = decodeURIComponent(nextEnc || "/");
          const desktopId = decodeURIComponent(desktopEnc || "");

          const redirectUri = `${requestUrl.origin}/api/public/auth/twitch/callback`;
          const tokenResponse = await fetch(
            "https://id.twitch.tv/oauth2/token",
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code,
                grant_type: "authorization_code",
                redirect_uri: redirectUri,
              }),
            },
          );
          if (!tokenResponse.ok) {
            res.statusCode = 400;
            res.end(
              `Twitch token exchange failed: ${await tokenResponse.text()}`,
            );
            return;
          }

          const token = (await tokenResponse.json()) as {
            access_token: string;
            expires_in?: number;
          };
          const userResponse = await fetch(
            "https://api.twitch.tv/helix/users",
            {
              headers: {
                Authorization: `Bearer ${token.access_token}`,
                "Client-Id": clientId,
              },
            },
          );
          if (!userResponse.ok) {
            res.statusCode = 400;
            res.end("Failed to load Twitch profile.");
            return;
          }
          const userJson = (await userResponse.json()) as {
            data?: Array<{ id: string; login: string; display_name: string }>;
          };
          const twitchUser = userJson.data?.[0];
          if (!twitchUser) {
            res.statusCode = 400;
            res.end("Twitch returned no user.");
            return;
          }

          if (desktopId) {
            completedTwitchAuthorizations.set(desktopId, {
              accessToken: token.access_token,
              clientId,
              expiresAt: Date.now() + 10 * 60 * 1000,
            });
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Set-Cookie", "tw_oauth=; Path=/; Max-Age=0");
            res.end(
              '<!doctype html><meta charset="utf-8"><title>Twitch authorized</title><body style="font-family:system-ui;background:#0b0b12;color:#eee;padding:2rem"><h1>Twitch authorized</h1><p>You can close this tab and return to Marbles Stats.</p></body>',
            );
            return;
          }

          const fragment = new URLSearchParams({
            access_token: token.access_token,
            expires_in: String(token.expires_in ?? 0),
            client_id: clientId,
            server_oauth: "1",
            twitch_user_id: twitchUser.id,
            twitch_login: twitchUser.login,
            twitch_display_name: twitchUser.display_name || twitchUser.login,
          });
          const destination = next.startsWith("/") ? next : "/";
          res.statusCode = 302;
          res.setHeader("Location", `${destination}#${fragment.toString()}`);
          res.setHeader("Set-Cookie", "tw_oauth=; Path=/; Max-Age=0");
          res.end();
          return;
        }

        if (requestUrl.pathname === "/api/public/auth/twitch/result") {
          const desktopId = requestUrl.searchParams.get("desktop") || "";
          const result = completedTwitchAuthorizations.get(desktopId);
          if (!result || result.expiresAt <= Date.now()) {
            if (result) completedTwitchAuthorizations.delete(desktopId);
            res.statusCode = 204;
            res.end();
            return;
          }
          completedTwitchAuthorizations.delete(desktopId);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(
            JSON.stringify({
              accessToken: result.accessToken,
              clientId: result.clientId,
            }),
          );
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  projectEnvironment = loadEnv(mode, process.cwd(), "");
  return {
    clearScreen: false,
    plugins: [twitchOAuthPlugin()],
    server: {
      host: "localhost",
      port: 8080,
      strictPort: true,
    },
  };
});
