import { icons } from "./icons";
import { sidebarArtwork } from "./sidebar-icons";
import { feedbackButton } from "./button-feedback";

export function streamDeckPage(): string {
  return `<div class="page-head simple"><div class="race-heading"><i class="race-heading-icon">${sidebarArtwork("streamdeck", "header-streamdeck")}</i><h1>Stream Deck</h1></div></div>
    <div class="integration-page-layout streamdeck-page-layout">
      <section class="panel settings-panel streamer-panel streamdeck-plugin-card"><div class="panel-body">
        <div class="streamdeck-plugin-content">
        <div class="twitch-layout-heading streamer-event-heading"><i>${icons.monitor}</i><h2>Marbles Stats Controls</h2><p>Start, stop, and monitor from your Stream Deck.</p></div>
        <div class="streamdeck-plugin-install"><div class="integration-connection-controls">${feedbackButton("streamdeck-controls-install", "Install Marbles Stats plugin", 'data-install-streamdeck-plugin data-streamdeck-plugin="controls" data-plugin-version="1.0.5" data-plugin-name="Marbles Stats plugin"', "file")}</div>
        <span class="streamdeck-plugin-meta">v1.0.5 &middot; Stream Deck 7.0+ &middot; Windows</span></div>
        </div>
        <div class="streamdeck-plugin-preview"><img class="streamdeck-plugin-sample" src="/streamdeck/previews/controls-sample.svg" width="208" height="96" alt="Sample of the RaceStats and RaceCycles keys"></div>
      </div></section>
      <section class="panel settings-panel streamer-panel streamdeck-plugin-card"><div class="panel-body">
        <div class="streamdeck-plugin-content">
        <div class="twitch-layout-heading streamer-event-heading"><i>${icons.twitch}</i><h2>MoS DropGate</h2><p>Customizable MoS Play button that will not send your msg if the stream is offline.</p><p><strong> Includes optional follow raids.</strong></p></div>
        <div class="streamdeck-plugin-install"><div class="integration-connection-controls">${feedbackButton("streamdeck-dropgate-install", "Install MoS Drop plugin", 'data-install-dropgate-plugin data-streamdeck-plugin="dropgate" data-plugin-version="0.4.4.6" data-plugin-name="MoS Drop plugin"', "file")}</div>
        <span class="streamdeck-plugin-meta">v0.4.4.6 &middot; Stream Deck 7.0+ &middot; Windows</span></div>
        </div>
        <div class="streamdeck-plugin-preview"><img class="streamdeck-plugin-sample" src="/streamdeck/previews/mosdropgate-default.svg" width="96" height="96" alt="MoS DropGate key featuring the rmrfkoHeart Twitch emote"></div>
      </div></section>
    </div>`;
}
