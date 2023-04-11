import { createProjectService, ProjectService } from './projectService';
import { createProject, Project } from './project';
import type { LanguageService, LanguageServiceHost, UserPreferences } from 'typescript/lib/tsserverlibrary';

// only create the once for all hosts, as this will improve performance as the internal cache can be reused
let projectService: ProjectService;
const projects = new Set<Project>()

export default function (
	ts: typeof import('typescript/lib/tsserverlibrary'),
	host: LanguageServiceHost,
	createLanguageService: (host: LanguageServiceHost) => LanguageService,
	rootDirectory: string
) {
	const hostConfiguration = { preferences: { includePackageJsonAutoImports: 'auto' } as UserPreferences };

	if (!projectService) {
		projectService = createProjectService(
			ts,
			ts.sys,
			rootDirectory,
			hostConfiguration,
			ts.LanguageServiceMode.Semantic
		);
	}

	const project = createProject(
		ts,
		host,
		createLanguageService,
		{
			projectService,
			rootNames: host.getScriptFileNames(),
			currentDirectory: host.getCurrentDirectory(),
			compilerOptions: host.getCompilationSettings(),
		}
	);

	// Immediatly invoke so the language service provider is setup
	// this preinitialises getting auto imports in IDE
	project.getPackageJsonAutoImportProvider();
	projects.add(project)

	return {
		languageService: project.languageService!,
		setPreferences(newPreferences: UserPreferences) {
			let onAutoImportProviderSettingsChanged = newPreferences.includePackageJsonAutoImports !== hostConfiguration.preferences.includePackageJsonAutoImports;
			hostConfiguration.preferences = newPreferences;
			if (onAutoImportProviderSettingsChanged) {
				project.onAutoImportProviderSettingsChanged();
			}
		},
		projectUpdated(path: string) {
			projects.forEach(projectToUpdate => {
				if (project === projectToUpdate || !projectToUpdate.autoImportProviderHost) return

				const realPaths = [...projectToUpdate.symlinks?.getSymlinkedDirectoriesByRealpath()?.keys() ?? []]
					.map(name => projectToUpdate.projectService.getNormalizedAbsolutePath(name));
				
				if (realPaths.includes(projectToUpdate.projectService.toCanonicalFileName(path))) {
					projectToUpdate.autoImportProviderHost.markAsDirty();
				}
			})
		},
	};
}
