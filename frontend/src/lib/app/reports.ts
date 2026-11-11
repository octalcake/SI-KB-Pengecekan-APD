import * as http from '#lib/features/reports/infrastructure/http-adapter';
import { createOperationRequestKey } from '#lib/features/reports/infrastructure/request-key';
import { createReportRequests as requests } from '#lib/features/reports/application/report-requests';
import { createReportContext } from '#lib/features/reports/application/report-context';
import * as lookups from './lookups';
export { canApproveReport } from '#lib/features/reports/application/report-requests';
export const createReportRequests = () => requests({ generate: http.generateReportApi, regenerate: http.regenerateReportApi, approve: http.approveReportApi }, createOperationRequestKey);
export const loadReportContext = createReportContext({ ...lookups, listReportsApi: http.listReportsApi, countConfirmedFindingsForSessionApi: http.countConfirmedFindingsForSessionApi });
export const { listReportsApi, getReportApi, createManualReportApi, updateReportApi, deleteReportApi } = http;
