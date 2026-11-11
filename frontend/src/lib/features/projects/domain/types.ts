export type RecordStatus = 'active' | 'archived';

export interface Project {
	id: number;
	name: string;
	location: string;
	description: string;
	status: RecordStatus;
	version: number;
	created_at: string;
	updated_at: string;
}

export interface Zone {
	id: number;
	project_id: number;
	name: string;
	description: string;
	status: RecordStatus;
	version: number;
	created_at: string;
	updated_at: string;
}

export interface ProjectListFilter {
	q?: string;
	status?: RecordStatus | '';
	page?: number;
	page_size?: number;
}

export interface ProjectCreateInput {
	name: string;
	location?: string;
	description?: string;
}

export interface ProjectUpdateInput {
	version: number;
	name?: string;
	location?: string;
	description?: string;
	status?: RecordStatus;
}

export interface ZoneListFilter {
	status?: RecordStatus | '';
	page?: number;
	page_size?: number;
}

export interface ZoneCreateInput {
	name: string;
	description?: string;
}

export interface ZoneUpdateInput {
	version: number;
	name?: string;
	description?: string;
	status?: RecordStatus;
}

export type { ApiListEnvelope as PaginatedList } from '#lib/shared/envelopes';
