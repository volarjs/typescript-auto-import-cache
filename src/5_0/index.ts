import { createProjectService, PackageJsonAutoImportPreference, ProjectService } from './projectService';
import { createProject } from './project';
import type { LanguageService, LanguageServiceHost } from 'typescript/lib/tsserverlibrary';

// only create the once for all hosts, as this will improve performance as the internal cache can be reused
let projectService: ProjectService;

export default function (
	ts: typeof import('typescript/lib/tsserverlibrary'),
	host: LanguageServiceHost,
	createLanguageService: (host: LanguageServiceHost) => LanguageService | undefined, 
	rootDirectory: string
): LanguageService | undefined {
	// will need to make this the workspace directory
	if (!projectService) {
		projectService = createProjectService(
			ts, 
			ts.sys, 
			rootDirectory,
			{ includePackageJsonAutoImports: PackageJsonAutoImportPreference.On }, 
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
	project.getPackageJsonAutoImportProvider()

	return project.languageService
}
