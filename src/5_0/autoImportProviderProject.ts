import type { CompilerOptions, LanguageService, LanguageServiceHost, ModuleResolutionHost, Program, TypeAcquisition } from 'typescript/lib/tsserverlibrary';
import { type Project, createProject, initProject } from './project';
import { PackageJsonAutoImportPreference } from './projectService';
import type { PackageJsonInfo } from './packageJsonCache';
import { SymlinkCache } from './symlinkCache';

interface AutoImportProviderProjectOptions {
	self: ReturnType<typeof createAutoImportProviderProjectStatic>
	rootNames: string[] | undefined
	hostProject: Project,
	compilerOptions: CompilerOptions
}

export function createAutoImportProviderProjectStatic(
	tsBase: typeof import('typescript/lib/tsserverlibrary'),
	host: LanguageServiceHost,
	createLanguageService: (host: LanguageServiceHost) => LanguageService
) {
	const ts = tsBase as any;
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
		timestamp,
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
					`AutoImportProviderProject: found ${rootNames.length} root files in ${dependenciesAdded} dependencies in ${timestamp() - start
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
					// some packages have giant exports maps, don't add them to the project to not slow down the editor
					if (entrypoints.length > 100) return;

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

			let rootNames: string[] | undefined = this.getRootFileNames(dependencySelection, hostProject, moduleResolutionHost, compilerOptions);
			if (!rootNames.length) {
				return undefined;
			}

			return createAutoImportProviderProject(tsBase, host, createLanguageService, { self: this, hostProject, rootNames, compilerOptions })
		}	
	};
}

function createAutoImportProviderProject(
	tsBase: typeof import('typescript/lib/tsserverlibrary'),
	host: LanguageServiceHost,
	createLanguageService: (host: LanguageServiceHost) => LanguageService,
	options: AutoImportProviderProjectOptions
) {
	const { self, rootNames, compilerOptions, hostProject } = options
	const ts = tsBase as any;
	const { some } = ts;

	const project = {
		...createProject(
			tsBase,
			host,
			createLanguageService,
			{
				projectService: hostProject.projectService,
				currentDirectory: hostProject.currentDirectory,
				compilerOptions,
			}
		),

		projectVersion: 0,
		getProjectVersion() {
			return this.projectVersion.toString();
		},

		rootFileNames: rootNames as undefined | string[],

		hostProject,

		isEmpty() {
			return !some(this.rootFileNames);
		},
	
		isOrphan() {
			return true;
		},
	
		updateGraph() {
			let rootFileNames = this.rootFileNames;
			if (!rootFileNames) {
				rootFileNames = self.getRootFileNames(
					this.hostProject.includePackageJsonAutoImports(),
					this.hostProject,
					this.hostProject.getModuleResolutionHostForAutoImportProvider(),
					this.getCompilationSettings());
			}
			this.rootFileNames = rootFileNames;
			const oldProgram = this.getCurrentProgram();
			this.program = this.languageService?.getProgram(); 
			this.dirty = false;
			if (oldProgram && oldProgram !== this.getCurrentProgram()) {
				this.hostProject.clearCachedExportInfoMap();
			}
		},

		scheduleInvalidateResolutionsOfFailedLookupLocations(): void {
			// Invalidation will happen on-demand as part of updateGraph
			return;
		},
	
		hasRoots() {
			return !!this.rootFileNames?.length;
		},
	
		markAsDirty() {
			if (!this.dirty) {
				this.rootFileNames = undefined;
				this.projectVersion++;
				this.dirty = true;
			}
		},
	
		getScriptFileNames() {
			return this.rootFileNames || ts.emptyArray;
		},
	
		getLanguageService(): never {
			throw new Error("AutoImportProviderProject language service should never be used. To get the program, use `project.getCurrentProgram()`.");
		},
	
		onAutoImportProviderSettingsChanged(): never {
			throw new Error("AutoImportProviderProject is an auto import provider; use `markAsDirty()` instead.");
		},
	
		onPackageJsonChange(): never {
			throw new Error("package.json changes should be notified on an AutoImportProvider's host project");
		},
	
		getModuleResolutionHostForAutoImportProvider(): never {
			throw new Error("AutoImportProviderProject cannot provide its own host; use `hostProject.getModuleResolutionHostForAutomImportProvider()` instead.");
		},

		includePackageJsonAutoImports() {
			return PackageJsonAutoImportPreference.Off;
		},
	
		getTypeAcquisition(): TypeAcquisition {
			return { enable: false };
		},
	
		getSymlinkCache() {
			return this.hostProject.getSymlinkCache();
		},

		getModuleResolutionCache() {
			// @ts-expect-error
			return this.hostProject.languageService?.getProgram()?.getModuleResolutionCache();
		},
	}

	return initProject(
		project,
		new Proxy(host, {
			get(target, key: keyof LanguageServiceHost) {
				return key in project ? (project as any)[key] : target[key];
			},
			set(_target, key, value) {
				(project as any)[key] = value;
				return true;
			}
		}),
		createLanguageService
	)
}
