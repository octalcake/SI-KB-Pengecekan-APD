<script lang="ts">
 import { page } from '$app/state';
 import ProjectDetailPage from '#lib/features/projects/presentation/ProjectDetailPage.svelte';
 const projectId = $derived(Number(page.params.id));
</script>

<ProjectDetailPage {projectId} />
