import * as lookup from './lookups';
import * as http from '#lib/features/findings/infrastructure/http-adapter';
import { createFindingsWorkflow } from '#lib/features/findings/application/findings-workflow';
const findings = createFindingsWorkflow({
	listFindings: http.listFindingsApi,
	getFinding: http.getFindingApi,
	reviewFinding: http.reviewFindingApi,
	deleteFinding: http.deleteFindingApi,
	createManualFinding: http.createManualFindingApi,
	listProjectsLookup: lookup.listProjectsLookupApi,
	listZonesLookup: lookup.listZonesLookupApi,
	getProjectLookup: lookup.getProjectLookupApi,
	getZoneLookup: lookup.getZoneLookupApi,
	listSessionsLookup: lookup.listSessionsLookupApi,
	getSessionLookup: lookup.getSessionLookupApi,
	createManualSession: lookup.createManualSessionApi,
	fetchProtectedEvidenceBlob: http.fetchProtectedEvidenceBlob,
});
export const {
	listFindings: listFindingsApi,
	getFinding: getFindingApi,
	reviewFinding: reviewFindingApi,
	deleteFinding: deleteFindingApi,
	createManualFinding: createManualFindingApi,
	listProjectsLookup: listProjectsLookupApi,
	listZonesLookup: listZonesLookupApi,
	getProjectLookup: getProjectLookupApi,
	getZoneLookup: getZoneLookupApi,
	listSessionsLookup: listSessionsLookupApi,
	getSessionLookup: getSessionLookupApi,
	createManualSession: createManualSessionApi,
	fetchProtectedEvidenceBlob: fetchProtectedEvidenceBlob,
	loadFindingContextLookups,
	loadGalleryLookups,
} = findings;
