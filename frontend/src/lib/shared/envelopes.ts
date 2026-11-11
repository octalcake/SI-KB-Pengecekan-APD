export interface PageMeta {
	page: number;
	page_size: number;
	total: number;
}

export interface ApiEnvelope<T> {
	data: T;
}

export interface ApiListEnvelope<T> {
	data: T[];
	meta: PageMeta;
}

export interface ApiErrorBody {
	code: string;
	message: string;
	fields?: Record<string, string>;
	request_id?: string;
}

export interface ApiErrorEnvelope {
	error: ApiErrorBody;
}
