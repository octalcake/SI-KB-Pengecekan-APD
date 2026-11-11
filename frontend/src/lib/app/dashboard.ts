import { createDashboardWorkflow } from '#lib/features/dashboard/application/dashboard-workflow';
import { dashboardSummaryApi } from '#lib/features/dashboard/infrastructure/http-adapter';
import { projects } from './projects';
export const dashboardWorkflow = createDashboardWorkflow({ getSummary: dashboardSummaryApi }, projects);
