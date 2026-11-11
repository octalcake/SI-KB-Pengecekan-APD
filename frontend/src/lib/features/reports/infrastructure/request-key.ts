export function createOperationRequestKey(): string {
	if(typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	const hex = '0123456789abcdef';
	let out = '';
	for(let i = 0; i < 36; i++) {
		if(i === 8 || i === 13 || i === 18 || i === 23) {
			out += '-';
		} else if(i === 14) {
			out += '4';
		} else if(i === 19) {
			out += hex[(Math.floor(Math.random() * 16) & 0x3) | 0x8];
		} else {
			out += hex[Math.floor(Math.random() * 16)];
		}
	}
	return out;
}
