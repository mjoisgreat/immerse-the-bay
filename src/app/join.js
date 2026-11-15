// app/join.js: the headset's "Invite friends" card (QR code, who is here, the narrate switch).
import { JoinCard, joinCardHit } from "../joincard.js";
import { owned } from "../identity.js";
import { joinUrl, joinersNarrate, setJoinersNarrate } from "../people.js";
import { camera, scene } from "./stage.js";
import { state } from "./state.js";
import { ROOM } from "./room.js";

let card = null; // built the first time it is opened

function refresh() {
  card?.refresh({
    url: joinUrl({ origin: location.origin, room: ROOM, invite: owned()[ROOM]?.invite, narrate: joinersNarrate() }),
    people: state.roomState?.people || [],
    narrate: joinersNarrate(),
  });
}
/** Opens the card. Returns true so the menu stays open: the card lives only while the menu does. */
export function showJoinCard() {
  if (!card) scene.add((card = new JoinCard()).mesh);
  refresh();
  card.show(camera);
  return true;
}
export function hideJoinCard() {
  card?.hide();
}
export const joinCardMesh = () => (card?.visible ? card.mesh : null);
/** A pinch on the card: the switch flips who can narrate, the lower strip closes it. */
export function pressJoinCard(uv) {
  const zone = joinCardHit(uv.x, uv.y);
  if (zone === "toggle") (setJoinersNarrate(!joinersNarrate()), refresh());
  else if (zone === "close") hideJoinCard();
}
/** New room state arrived: keep an open card's list of people current. */
export function updateJoinCard() {
  if (card?.visible) refresh();
}
