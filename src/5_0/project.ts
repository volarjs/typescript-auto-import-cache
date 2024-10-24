import type {
	CompilerOptions,
	LanguageServiceHost,
	Program,
	ModuleResolutionHost,
	PerformanceEvent,
	LanguageService
} from 'typescript/lib/tsserverlibrary';
import type { ProjectPackageJsonInfo } from './packageJsonCache';
import { ProjectService, PackageJsonAutoImportPreference } from './projectService';
import { createModuleSpecifierCache } from './moduleSpecifierCache';
import { createAutoImportProviderProjectStatic } from './autoImportProviderProject';
import { SymlinkCache } from './symlinkCache';
import { ExportInfoMap } from './exportInfoMap';

export type Project = ReturnType<typeof createProject>;
export interface ProjectOptions { 
	projectService: ProjectService;
	compilerOptions: CompilerOptions;
	currentDirectory: string;
	createModuleSpecifierCache?: typeof createModuleSpecifierCache;
};

export function createProject(
	ts: typeof import('typescript/lib/tsserverlibrary'),
	host: LanguageServiceHost,
	createLanguageService: (host: LanguageServiceHost) => LanguageService,
	options: ProjectOptions
) {
	const {
		combinePaths,
		inferredTypesContainingFile,
		createSymlinkCache,
		toPath,
		createCacheableExportInfoMap,
		timestamp,
		isInsideNodeModules,
		LanguageServiceMode,
	} = ts as any;

	const tsCreateModuleSpecifierCache = (ts.server as any)?.createModuleSpecifierCache;
	const noopHost = {
		watchNodeModulesForPackageJsonChanges: () => ({ close: () => { } }),
		toPath
	}
	const AutoImportProviderProject = createAutoImportProviderProjectStatic(ts, host, createLanguageService);

	const { projectService, compilerOptions, currentDirectory } = options;

	function updateProjectIfDirty(project: any) {
		return project.dirty && project.updateGraph();
	}
	
	return {
		dirty: false,
		hostProject: undefined as any,
		languageServiceEnabled: true,
		languageService: undefined as undefined | LanguageService,
		projectService,
		getCanonicalFileName: projectService.toCanonicalFileName,

		exportMapCache: undefined as undefined | ExportInfoMap,
		getCachedExportInfoMap() {
			return (this.exportMapCache ||= createCacheableExportInfoMap(this));
		},
		clearCachedExportInfoMap() {
			this.exportMapCache?.clear();
		},

		moduleSpecifierCache: tsCreateModuleSpecifierCache 
			? tsCreateModuleSpecifierCache(noopHost)
			: (options.createModuleSpecifierCache ?? createModuleSpecifierCache)(),
		getModuleSpecifierCache() {
			return this.moduleSpecifierCache;
		},

		compilerOptions,
		getCompilationSettings() {
			return this.compilerOptions;
		},
		getCompilerOptions() {
			return this.compilerOptions;
		},

		program: undefined as undefined | Program,
		getCurrentProgram(): Program | undefined {
			return this.program;
		},

		currentDirectory: projectService.getNormalizedAbsolutePath(currentDirectory || ''),
		getCurrentDirectory(): string {
			return this.currentDirectory;
		},

		symlinks: undefined as SymlinkCache | undefined,
		getSymlinkCache(): SymlinkCache {
			if (!this.symlinks) {
				this.symlinks = createSymlinkCache(this.getCurrentDirectory(), this.getCanonicalFileName) as SymlinkCache;
			}

			if (this.program && !this.symlinks.hasProcessedResolutions()) {
				this.symlinks.setSymlinksFromResolutions(
					this.program.getSourceFiles(),
					// @ts-expect-error
					this.program.getAutomaticTypeDirectiveResolutions(),
				);
			}
			return this.symlinks;
		},

		packageJsonsForAutoImport: undefined as Set<string> | undefined,
		getPackageJsonsForAutoImport(rootDir?: string): readonly ProjectPackageJsonInfo[] {
			const packageJsons = this.getPackageJsonsVisibleToFile(
				combinePaths(this.currentDirectory, inferredTypesContainingFile),
				rootDir,
			);
			this.packageJsonsForAutoImport = new Set(packageJsons.map((p) => p.fileName));
			return packageJsons;
		},
		getPackageJsonsVisibleToFile(fileName: string, rootDir?: string): readonly ProjectPackageJsonInfo[] {
			return this.projectService.getPackageJsonsVisibleToFile(fileName, rootDir);
		},

		getModuleResolutionHostForAutoImportProvider(): ModuleResolutionHost {
			if (this.program) {
				return {
					// @ts-expect-error
					fileExists: this.program.fileExists,
					// @ts-expect-error
					directoryExists: this.program.directoryExists,
					// @ts-expect-error
					realpath: this.program.realpath || this.projectService.host.realpath?.bind(this.projectService.host),
					getCurrentDirectory: this.getCurrentDirectory.bind(this),
					readFile: this.projectService.host.readFile.bind(this.projectService.host),
					getDirectories: this.projectService.host.getDirectories.bind(this.projectService.host),
					// trace: this.projectService.host.trace?.bind(this.projectService.host),
					trace: () => { },
					// @ts-expect-error
					useCaseSensitiveFileNames: this.program.useCaseSensitiveFileNames(),
				};
			}
			return this.projectService.host;
		},

		autoImportProviderHost: undefined as
			| undefined
			| false
			| { getCurrentProgram(): Program | undefined; isEmpty(): boolean; close(): void; markAsDirty(): void; },
		getPackageJsonAutoImportProvider(): Program | undefined {
			if (this.autoImportProviderHost === false) {
				return undefined;
			}

			if (this.projectService.serverMode !== LanguageServiceMode.Semantic) {
				this.autoImportProviderHost = false;
				return undefined;
			}

			if (this.autoImportProviderHost) {
				updateProjectIfDirty(this.autoImportProviderHost);
				if (this.autoImportProviderHost.isEmpty()) {
					this.autoImportProviderHost.close();
					this.autoImportProviderHost = undefined;
					return undefined;
				}
				return this.autoImportProviderHost.getCurrentProgram();
			}

			const dependencySelection = projectService.includePackageJsonAutoImports();
			if (dependencySelection) {
				// tracing?.push(tracing.Phase.Session, "getPackageJsonAutoImportProvider");
				const start = timestamp();
				this.autoImportProviderHost = AutoImportProviderProject.create(
					dependencySelection,
					this,
					this.getModuleResolutionHostForAutoImportProvider(),
				);
				if (this.autoImportProviderHost) {
					updateProjectIfDirty(this.autoImportProviderHost);
					this.sendPerformanceEvent('CreatePackageJsonAutoImportProvider', timestamp() - start);
					// tracing?.pop();
					return this.autoImportProviderHost.getCurrentProgram();
				}
				// tracing?.pop();
			}
		},

		includePackageJsonAutoImports(): PackageJsonAutoImportPreference {
			if (
				this.projectService.includePackageJsonAutoImports() === PackageJsonAutoImportPreference.Off ||
				!this.languageServiceEnabled ||
				isInsideNodeModules(this.currentDirectory) /* ||
				!this.isDefaultProjectForOpenFiles()*/
			) {
				return PackageJsonAutoImportPreference.Off;
			}
			return this.projectService.includePackageJsonAutoImports();
		},

		close() { },
		log(_message: string) { },
		sendPerformanceEvent(_kind: PerformanceEvent['kind'], _durationMs: number) { },

		toPath(fileName: string) {
			return toPath(fileName, this.currentDirectory, this.projectService.toCanonicalFileName);
		},

		getGlobalTypingsCacheLocation() {
			return undefined;
		},

		useSourceOfProjectReferenceRedirect() {
			return !this.getCompilerOptions().disableSourceOfProjectReferenceRedirect;
		},

		onAutoImportProviderSettingsChanged() {
			if (this.autoImportProviderHost === false) {
				this.autoImportProviderHost = undefined;
			}
			else {
				this.autoImportProviderHost?.markAsDirty();
			}
		},
	};
}

export function initProject<P extends Project>(
	project: P,
	host: LanguageServiceHost, 
	createLanguageService: (host: LanguageServiceHost) => LanguageService
): P {
	const languageService = createLanguageService(host);
	project.languageService = languageService;
	project.program = languageService.getProgram(); 
	return project
}
