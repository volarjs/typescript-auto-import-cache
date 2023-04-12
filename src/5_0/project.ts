import type {
	CompilerOptions,
	LanguageServiceHost,
	Path,
	Program,
	ModuleResolutionHost,
	PerformanceEvent,
	LanguageService,
	ProjectReference
} from 'typescript/lib/tsserverlibrary';
import type { ProjectPackageJsonInfo } from './packageJsonCache';
import { ProjectService, PackageJsonAutoImportPreference } from './projectService';
import { createModuleSpecifierCache } from './moduleSpecifierCache';
import { createAutoImportProviderProjectStatic } from './autoImportProviderProject';
import { SymlinkCache } from './symlinkCache';
import { ExportInfoMap } from './exportInfoMap';

export type Project = ReturnType<typeof createBaseProject>;
interface ProjectOptions { 
	projectService: ProjectService;
	compilerOptions: CompilerOptions;
	currentDirectory: string;
	rootNames: string[] | undefined;
};

export function createProject(
	ts: typeof import('typescript/lib/tsserverlibrary'),
	host: LanguageServiceHost,
	createLanguageService: (host: LanguageServiceHost) => LanguageService,
	options: ProjectOptions,
): Project {
	const project = createBaseProject(ts, host, createLanguageService, options);
	const languageService = createLanguageService(
		new Proxy(host, {
			get(target, key: keyof LanguageServiceHost) {
				return target[key] ?? (project as any)[key];
			},
			set(_target, key, value) {
				(project as any)[key] = value;
				return true;
			}
		})
	);
	project.languageService = languageService;
	project.languageServiceEnabled = !!languageService;
	project.program = languageService.getProgram(); 
	return project;
}

function createBaseProject(
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
	const AutoImportProviderProject = createAutoImportProviderProjectStatic(ts, host, createLanguageService);

	const { projectService, compilerOptions, currentDirectory } = options;

	function updateProjectIfDirty(project: any) {
		return project.dirty && project.updateGraph();
	}
	
	return {
		dirty: false,

		hostProject: undefined as any,

		projectService,

		getCanonicalFileName: projectService.toCanonicalFileName,

		exportMapCache: undefined as undefined | ExportInfoMap,
		getCachedExportInfoMap() {
			return (this.exportMapCache ||= createCacheableExportInfoMap(this));
		},
		clearCachedExportInfoMap() {
			this.exportMapCache?.clear();
		},

		moduleSpecifierCache: createModuleSpecifierCache(),
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

		getProjectReferences(): readonly ProjectReference[] | undefined {
			return host.getProjectReferences?.()
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

		get rootNames() {
			return options.rootNames;
		},
		getScriptFileNames() {
			return this.rootNames;
		},
		getSourceFile(path: Path) {
			if (!this.program) {
				return undefined;
			}
			return this.program.getSourceFileByPath(path);
		},

		isEmpty() {
			return !this.rootNames?.length;
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

		languageServiceEnabled: true,
		languageService: undefined as undefined | LanguageService,
		getLanguageService() {
			return this.languageService;
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

		getCachedDirectoryStructureHost(): undefined {
			return undefined!; // TODO: GH#18217
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

		onPackageJsonChange() { }
	};
}
