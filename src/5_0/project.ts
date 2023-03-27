import type {
	CompilerOptions,
	LanguageServiceHost,
	Path,
	Program,
	ModuleResolutionHost,
	PerformanceEvent,
} from 'typescript/lib/tsserverlibrary';
import type { PackageJsonInfo, ProjectPackageJsonInfo } from './packageJsonCache';
import { ProjectService, PackageJsonAutoImportPreference } from './projectService';
import { createModuleSpecifierCache } from './moduleSpecifierCache';

export type Project = ReturnType<typeof createProject>;

type SymlinkCache = any;

export function createProject(
	ts: typeof import('typescript/lib/tsserverlibrary'),
	host: LanguageServiceHost,
	projectService: ProjectService,
	rootNames: string[],
	currentDirectory: string,
	compilerOptions: CompilerOptions,
	program: Program | undefined,
) {
	const {
		combinePaths,
		inferredTypesContainingFile,
		createSymlinkCache,
		toPath,
		createCacheableExportInfoMap,
		timestamp,
		isInsideNodeModules,
		LanguageServiceMode
	} = ts as any;
	const AutoImportProviderProject = createAutoImportProviderProject(ts, host);

	let projectVersion = host.getProjectVersion?.()
	function updateProjectIfDirty(project: any) {
		const newVersion = host.getProjectVersion?.()
		if (projectVersion === newVersion) return
		projectVersion = newVersion
		project.hostProject?.clearCachedExportInfoMap()
	}
		
	return {
		projectService,

		getCanonicalFileName: projectService.toCanonicalFileName,

		exportMapCache: undefined as undefined | { clear(): void },
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

		program,
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
				this.symlinks = createSymlinkCache(this.getCurrentDirectory(), this.getCanonicalFileName);
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

		rootNames,
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
			return !this.rootNames.length;
		},

		getModuleResolutionHostForAutoImportProvider(): ModuleResolutionHost {
			if (this.program) {
				return {
					// @ts-expect-error
					fileExists: this.program.fileExists,
					// @ts-expect-error
					directoryExists: this.program.directoryExists,
					realpath: undefined,
					getCurrentDirectory: this.getCurrentDirectory.bind(this),
					readFile: this.projectService.host.readFile.bind(this.projectService.host),
					getDirectories: this.projectService.host.getDirectories.bind(this.projectService.host),
					// trace: this.projectService.host.trace?.bind(this.projectService.host),
					trace: () => {},
					// @ts-expect-error
					useCaseSensitiveFileNames: this.program.useCaseSensitiveFileNames(),
				};
			}
			return this.projectService.host;
		},

		autoImportProviderHost: undefined as
			| undefined
			| false
			| { getCurrentProgram(): Program | undefined; isEmpty(): boolean; close(): void },
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

		close() {},
		log(_message: string) {},
		sendPerformanceEvent(_kind: PerformanceEvent['kind'], _durationMs: number) {},

		toPath(fileName: string) {
			return toPath(fileName, this.currentDirectory, this.projectService.toCanonicalFileName);
		},

		getCachedDirectoryStructureHost(): undefined {
			return undefined!; // TODO: GH#18217
		},

		getGlobalTypingsCacheLocation() {
			return undefined;
		},
	};
}

function createAutoImportProviderProject(tsBase: typeof import('typescript/lib/tsserverlibrary'), host: LanguageServiceHost) {
	const ts = tsBase as any
	const {
		combinePaths,
		inferredTypesContainingFile,
		arrayFrom,
		resolvePackageNameToPackageJson,
		concatenate,
		forEach,
		startsWith,
		getEntrypointsFromPackageJsonInfo,
		mapDefined,
		timestamp
	} = ts;
	return {
		maxDependencies: 10,

		compilerOptionsOverrides: {
			diagnostics: false,
			skipLibCheck: true,
			sourceMap: false,
			types: ts.emptyArray,
			lib: ts.emptyArray,
			noLib: true,
		},

		getRootFileNames(
			dependencySelection: PackageJsonAutoImportPreference,
			hostProject: Project,
			moduleResolutionHost: ModuleResolutionHost,
			compilerOptions: CompilerOptions,
		): string[] {
			if (!dependencySelection) {
				return ts.emptyArray;
			}
			const program = hostProject.getCurrentProgram();
			if (!program) {
				return ts.emptyArray;
			}

			const start = timestamp();
			let dependencyNames: Set<string> | undefined;
			let rootNames: string[] | undefined;
			const rootFileName = combinePaths(hostProject.currentDirectory, inferredTypesContainingFile);
			const packageJsons = hostProject.getPackageJsonsForAutoImport(combinePaths(hostProject.currentDirectory, rootFileName));
			for (const packageJson of packageJsons) {
				packageJson.dependencies?.forEach((_, dependenyName) => addDependency(dependenyName));
				packageJson.peerDependencies?.forEach((_, dependencyName) => addDependency(dependencyName));
			}

			let dependenciesAdded = 0;
			if (dependencyNames) {
				const symlinkCache = hostProject.getSymlinkCache();
				for (const name of arrayFrom(dependencyNames.keys())) {
					// Avoid creating a large project that would significantly slow down time to editor interactivity
					if (dependencySelection === PackageJsonAutoImportPreference.Auto && dependenciesAdded > this.maxDependencies) {
						hostProject.log(
							`AutoImportProviderProject: attempted to add more than ${this.maxDependencies} dependencies. Aborting.`,
						);
						return ts.emptyArray;
					}

					// 1. Try to load from the implementation package. For many dependencies, the
					//	package.json will exist, but the package will not contain any typings,
					//	so `entrypoints` will be undefined. In that case, or if the dependency
					//	is missing altogether, we will move on to trying the @types package (2).
					const packageJson = resolvePackageNameToPackageJson(
						name,
						hostProject.currentDirectory,
						compilerOptions,
						moduleResolutionHost,
						// @ts-expect-error
						program.getModuleResolutionCache(),
					);
					if (packageJson) {
						const entrypoints = getRootNamesFromPackageJson(packageJson, program, symlinkCache);
						if (entrypoints) {
							rootNames = concatenate(rootNames, entrypoints);
							dependenciesAdded += entrypoints.length ? 1 : 0;
							continue;
						}
					}

					// 2. Try to load from the @types package in the tree and in the global
					//	typings cache location, if enabled.
					// @ts-expect-error
					const done = forEach([hostProject.currentDirectory, hostProject.getGlobalTypingsCacheLocation()], (directory) => {
						if (directory) {
							const typesPackageJson = resolvePackageNameToPackageJson(
								`@types/${name}`,
								directory,
								compilerOptions,
								moduleResolutionHost,
								// @ts-expect-error
								program.getModuleResolutionCache(),
							);
							if (typesPackageJson) {
								const entrypoints = getRootNamesFromPackageJson(typesPackageJson, program, symlinkCache);
								rootNames = concatenate(rootNames, entrypoints);
								dependenciesAdded += entrypoints?.length ? 1 : 0;
								return true;
							}
						}
					});

					if (done) continue;

					// 3. If the @types package did not exist and the user has settings that
					//	allow processing JS from node_modules, go back to the implementation
					//	package and load the JS.
					if (packageJson && compilerOptions.allowJs && compilerOptions.maxNodeModuleJsDepth) {
						const entrypoints = getRootNamesFromPackageJson(packageJson, program, symlinkCache, /*allowJs*/ true);
						rootNames = concatenate(rootNames, entrypoints);
						dependenciesAdded += entrypoints?.length ? 1 : 0;
					}
				}
			}

			if (rootNames?.length) {
				hostProject.log(
					`AutoImportProviderProject: found ${rootNames.length} root files in ${dependenciesAdded} dependencies in ${
						timestamp() - start
					} ms`,
				);
			}
			return rootNames || ts.emptyArray;

			function addDependency(dependency: string) {
				if (!startsWith(dependency, '@types/')) {
					(dependencyNames || (dependencyNames = new Set())).add(dependency);
				}
			}

			function getRootNamesFromPackageJson(
				packageJson: PackageJsonInfo,
				program: Program,
				symlinkCache: SymlinkCache,
				resolveJs?: boolean,
			) {
				const entrypoints = getEntrypointsFromPackageJsonInfo(
					packageJson,
					compilerOptions,
					moduleResolutionHost,
					// @ts-expect-error
					program.getModuleResolutionCache(),
					resolveJs,
				);
				if (entrypoints) {
					const real = moduleResolutionHost.realpath?.(packageJson.packageDirectory);
					const isSymlink = real && real !== packageJson.packageDirectory;
					if (isSymlink) {
						symlinkCache.setSymlinkedDirectory(packageJson.packageDirectory, {
							real,
							realPath: hostProject.toPath(real),
						});
					}

					// @ts-expect-error
					return mapDefined(entrypoints, (entrypoint) => {
						const resolvedFileName = isSymlink ? entrypoint.replace(packageJson.packageDirectory, real) : entrypoint;
						if (!program.getSourceFile(resolvedFileName) && !(isSymlink && program.getSourceFile(entrypoint))) {
							return resolvedFileName;
						}
					});
				}
			}
		},

		create(dependencySelection: PackageJsonAutoImportPreference, hostProject: Project, moduleResolutionHost: ModuleResolutionHost) {
			if (dependencySelection === PackageJsonAutoImportPreference.Off) {
				return undefined;
			}

			const compilerOptions = {
				...hostProject.getCompilerOptions(),
				...this.compilerOptionsOverrides,
			};

			const rootNames = this.getRootFileNames(dependencySelection, hostProject, moduleResolutionHost, compilerOptions);
			if (!rootNames.length) {
				return undefined;
			}

			return {
				hostProject,
				...createProject(
					tsBase,
					host,
					hostProject.projectService,
					rootNames,
					hostProject.currentDirectory,
					compilerOptions,
					tsBase.createProgram({
						host: host.getCompilerHost?.(),
						rootNames,
						options: compilerOptions,
						oldProgram: hostProject.program,
					}),
				),

				getLanguageService(): never {
					throw new Error(
						'AutoImportProviderProject language service should never be used. To get the program, use `project.getCurrentProgram()`.',
					);
				},

				/** @internal */
				onAutoImportProviderSettingsChanged(): never {
					throw new Error('AutoImportProviderProject is an auto import provider; use `markAsDirty()` instead.');
				},

				/** @internal */
				onPackageJsonChange(): never {
					throw new Error("package.json changes should be notified on an AutoImportProvider's host project");
				},

				getModuleResolutionHostForAutoImportProvider(): never {
					throw new Error(
						'AutoImportProviderProject cannot provide its own host; use `hostProject.getModuleResolutionHostForAutomImportProvider()` instead.',
					);
				},

				includePackageJsonAutoImports() {
					return PackageJsonAutoImportPreference.Off;
				},

				getSymlinkCache() {
					return this.hostProject.getSymlinkCache();
				},
			};
		},
	};
}
