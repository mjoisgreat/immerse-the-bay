// Reads a Twitch channel's chat, anonymously (no account or token needed: "justinfan" logins are
// Twitch's read-only guests). Reconnects on its own. onMessage({ user, text, color }).

const URL_IRC = "wss://irc-ws.chat.twitch.tv:443";

/** "https://www.twitch.tv/Some_Name" or "#some_name" or "some_name" → "some_name". */
export function channelOf(v) {
  const s = String(v || "").trim().replace(/^https?:\/\/(www\.)?twitch\.tv\//i, "").replace(/^#/, "");
  return s.split(/[/?#]/)[0].toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 25);
}

/** One IRC line → { tags, prefix, command, params, trailing }. */
export function parseIrc(line) {
  let rest = line, tags = {}, prefix = "";
  if (rest.startsWith("@")) {
    const i = rest.indexOf(" ");
    for (const kv of rest.slice(1, i).split(";")) {
      const j = kv.indexOf("=");
      tags[kv.slice(0, j)] = kv.slice(j + 1).replace(/\\s/g, " ").replace(/\\:/g, ";").replace(/\\\\/g, "\\");
    }
    rest = rest.slice(i + 1);
  }
  if (rest.startsWith(":")) {
    const i = rest.indexOf(" ");
    prefix = rest.slice(1, i);
    rest = rest.slice(i + 1);
  }
  const t = rest.indexOf(" :");
  const trailing = t === -1 ? "" : rest.slice(t + 2);
  const [command, ...params] = (t === -1 ? rest : rest.slice(0, t)).split(" ");
  return { tags, prefix, command, params, trailing };
}

export function connectTwitch(channel, { onMessage, onStatus = () => {} }) {
  let ws, stopped = false, retry = 1000, timer;
  function open() {
    onStatus("connecting");
    ws = new WebSocket(URL_IRC);
    ws.onopen = () => {
      ws.send("CAP REQ :twitch.tv/tags");
      ws.send("PASS SCHMOOPIIE");
      ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
      ws.send(`JOIN #${channel}`);
    };
    ws.onmessage = (e) => {
      for (const line of String(e.data).split("\r\n")) {
        if (!line) continue;
        if (line.startsWith("PING")) {
          ws.send(line.replace("PING", "PONG"));
          continue;
        }
        const m = parseIrc(line);
        if (m.command === "JOIN") onStatus("live"), (retry = 1000);
        if (m.command === "RECONNECT") ws.close();
        if (m.command !== "PRIVMSG") continue;
        const user = m.tags["display-name"] || m.prefix.split("!")[0];
        onMessage({ user, login: m.prefix.split("!")[0], text: m.trailing, color: m.tags.color || "" });
      }
    };
    ws.onclose = () => {
      if (stopped) return onStatus("off");
      onStatus("reconnecting");
      timer = setTimeout(open, retry);
      retry = Math.min(retry * 2, 15000);
    };
  }
  open();
  return {
    close() {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
