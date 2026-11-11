export type EvidenceLoadStatus =
	| { state: 'loading' }
	| { state: 'ready'; objectUrl: string; byteLength: number }
	| {
		state: 'error';
		status: number;
		code: string;
		message: string;
		requestId: string | null;
		isMissingEvidence: boolean;
		isUnauthorized: boolean;
		isForbidden: boolean;
		isNetworkError: boolean;
	};
