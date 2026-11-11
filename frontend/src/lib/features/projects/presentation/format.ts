export function translateFieldError(field: string, code: string): string {
	const label =
		field === 'name'
			? 'Nama'
			: field === 'location'
				? 'Lokasi'
				: field === 'description'
					? 'Deskripsi'
					: field === 'status'
						? 'Status'
						: field === 'version'
							? 'Versi'
							: field;

	if(code === 'required') return `${label} wajib diisi.`;
	if(code === 'too_long') {
		if(field === 'name') return `${label} maksimal 120 karakter.`;
		if(field === 'location') return `${label} maksimal 200 karakter.`;
		if(field === 'description') return `${label} maksimal 2.000 karakter.`;
		return `${label} melebihi batas panjang karakter.`;
	}
	if(code === 'invalid') return `${label} tidak valid.`;
	return `${label}: ${code}`;
}

export function formatIndonesianDateTime(
	isoString: string,
	timeZone = 'Asia/Jakarta'
): string {
	if(!isoString) return '-';
	const date = new Date(isoString);
	if(Number.isNaN(date.getTime())) return isoString;
	try {
		return new Intl.DateTimeFormat('id-ID', {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone
		}).format(date);
	} catch {
		return date.toISOString();
	}
}
