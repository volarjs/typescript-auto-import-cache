import { createProjectService, PackageJsonAutoImportPreference, ProjectService } from './projectService';
import { createProject } from './project';
import type { LanguageService, LanguageServiceHost } from 'typescript/lib/tsserverlibrary';

// only create the once for all hosts, as this will improve performance as the internal cache can be reused
let projectService: ProjectService;

export default function (ts: typeof import('typescript/lib/tsserverlibrary'), host: LanguageServiceHost, service: LanguageService, rootDirectory: string) {
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
		projectService,
		host.getScriptFileNames(),
		host.getCurrentDirectory(),
		host.getCompilationSettings(),
		service.getProgram(),
	);
	project.getPackageJsonAutoImportProvider();

	// @ts-expect-error
	host.getPackageJsonsVisibleToFile = (fileName: string, rootDir: string | undefined) => project.getPackageJsonsVisibleToFile(fileName, rootDir);
	// @ts-expect-error
	host.includePackageJsonAutoImports = () => project.includePackageJsonAutoImports();
	// @ts-expect-error
	host.getCachedExportInfoMap = () => project.getCachedExportInfoMap();
	// @ts-expect-error
	host.getModuleSpecifierCache = () => project.getModuleSpecifierCache();
	// @ts-expect-error
	host.getPackageJsonsForAutoImport = (rootDir: string | undefined) => project.getPackageJsonsForAutoImport(rootDir);
	// @ts-expect-error
	host.getPackageJsonAutoImportProvider = () => project.getPackageJsonAutoImportProvider();
	host.getScriptFileNames = () => project.getScriptFileNames();
}
