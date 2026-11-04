const ROOM_CODE=/^[A-Z0-9]{3,16}$/;
/** Only codes already known to this browser/actor are linked; never derive a code from an event id. */
export function safeRoomCode(code:unknown){return typeof code==='string'&&ROOM_CODE.test(code)?code:undefined;}
