export {
	API_BASE,
	ApiError,
	apiData,
	apiList,
	apiNoContent,
	apiRequest,
	getCsrfToken,
	healthApi,
	isApiError,
	loginApi,
	logoutApi,
	meApi,
	onUnauthorized,
	setCsrfToken,
	systemStatusApi,
	type ApiErrorInit,
	type ApiRequestOptions
} from '#lib/api/client';

export { authSession, type AuthBootstrapStatus } from '#lib/auth/session.svelte';

export type {
	ApiEnvelope,
	ApiErrorBody,
	ApiErrorEnvelope,
	ApiListEnvelope,
	AuthSessionPayload,
	HealthStatus,
	PageMeta,
	SystemMode,
	SystemStatus,
	User,
	ViolationType
} from '#lib/types/api';

export {
	createProjectApi,
	createZoneApi,
	deleteProjectApi,
	deleteZoneApi,
	formatIndonesianDateTime,
	getProjectApi,
	getZoneApi,
	listProjectsApi,
	listZonesApi,
	translateFieldError,
	updateProjectApi,
	updateZoneApi,
	type Project,
	type ProjectCreateInput,
	type ProjectListFilter,
	type ProjectUpdateInput,
	type RecordStatus,
	type Zone,
	type ZoneCreateInput,
	type ZoneListFilter,
	type ZoneUpdateInput
} from '#lib/projects/api';

export {
	dashboardSummaryApi,
	localDateRangeToUtcInterval,
	localDateStartToUtcIso,
	type DashboardSummary,
	type DashboardSummaryFilter
} from '#lib/dashboard/api';

