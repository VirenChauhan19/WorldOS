import type { FurnitureItem, FurniturePlacement, RoomSize } from '../room/layout';
import { parseScene } from './scene';
import type { DesignScene } from './scene';

const HANDOFF_KEY = 'worldos.ar-room-handoff.v1';

/** Carry the current arrangement, without generating or moving any pieces. */
export function roomScene(name: string, room: RoomSize, items: readonly FurnitureItem[], placements: readonly FurniturePlacement[]): DesignScene | null {
  if (!placements.length) return null;
  const objects = placements.map(placement => ({ item: items.find(item => item.id === placement.itemId), placement }));
  return parseScene({ version: 1, name: name.trim().slice(0, 80) || 'Room layout', room, objects });
}

/** The route contains an opaque key; room contents stay in this tab. */
export function prepareRoomHandoff(scene: DesignScene): string {
  const valid = parseScene(scene);
  if (!valid || !valid.objects.length) throw new Error('Arrange at least one piece inside your room before opening AR.');
  const token = crypto.randomUUID();
  try { sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ token, scene: valid })); }
  catch { throw new Error('Your layout could not be opened in AR. Allow storage in this browser and try again.'); }
  return token;
}

/** Consume once, including on cancel, so back/forward cannot replace a design later. */
export function consumeRoomHandoff(token: string | null): DesignScene | null {
  if (!token || token.length > 100) return null;
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw || raw.length > 128_000) return null;
    const value = JSON.parse(raw) as { token?: unknown; scene?: unknown };
    if (value.token !== token) return null;
    sessionStorage.removeItem(HANDOFF_KEY);
    const valid = parseScene(value.scene);
    return valid?.objects.length ? valid : null;
  } catch { return null; }
}
