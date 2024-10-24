import type { FileWatcher, Path, UserPreferences } from 'typescript/lib/tsserverlibrary';
import { ModulePath, ModuleSpecifierOptions } from '../5_0/moduleSpecifierCache';

export interface ResolvedModuleSpecifierInfo {
	kind: "node_modules" | "paths" | "redirect" | "relative" | "ambient" | undefined;
	modulePaths: readonly ModulePath[] | undefined;
    packageName: string | undefined;
	moduleSpecifiers: readonly string[] | undefined;
	isBlockedByPackageJsonDependencies: boolean | undefined;
}

export interface ModuleSpecifierCache {
    get(fromFileName: Path, toFileName: Path, preferences: UserPreferences, options: ModuleSpecifierOptions): Readonly<ResolvedModuleSpecifierInfo> | undefined;
    set(fromFileName: Path, toFileName: Path, preferences: UserPreferences, options: ModuleSpecifierOptions, kind: ResolvedModuleSpecifierInfo["kind"], modulePaths: readonly ModulePath[], moduleSpecifiers: readonly string[]): void;
    setBlockedByPackageJsonDependencies(fromFileName: Path, toFileName: Path, preferences: UserPreferences, options: ModuleSpecifierOptions, packageName: string | undefined, isBlockedByPackageJsonDependencies: boolean): void;
    setModulePaths(fromFileName: Path, toFileName: Path, preferences: UserPreferences, options: ModuleSpecifierOptions, modulePaths: readonly ModulePath[]): void;
    clear(): void;
    count(): number;
}

export function createModuleSpecifierCache(
	// host: ModuleSpecifierResolutionCacheHost
): ModuleSpecifierCache {
	let containedNodeModulesWatchers: Map<string, FileWatcher> | undefined;
	let cache: Map<Path, ResolvedModuleSpecifierInfo> | undefined;
	let currentKey: string | undefined;
	const result: ModuleSpecifierCache = {
		get(fromFileName, toFileName, preferences, options) {
			if (!cache || currentKey !== key(fromFileName, preferences, options)) return undefined;
			return cache.get(toFileName);
		},
		set(fromFileName, toFileName, preferences, options, kind, modulePaths, moduleSpecifiers) {
			ensureCache(fromFileName, preferences, options).set(toFileName, createInfo(kind, modulePaths, moduleSpecifiers, /*packageName */undefined, /*isBlockedByPackageJsonDependencies*/ false));

			// If any module specifiers were generated based off paths in node_modules,
			// a package.json file in that package was read and is an input to the cached.
			// Instead of watching each individual package.json file, set up a wildcard
			// directory watcher for any node_modules referenced and clear the cache when
			// it sees any changes.
			if (moduleSpecifiers) {
				for (const p of modulePaths) {
					if (p.isInNodeModules) {
						// No trailing slash
						// const nodeModulesPath = p.path.substring(0, p.path.indexOf(nodeModulesPathPart) + nodeModulesPathPart.length - 1);
						// const key = host.toPath(nodeModulesPath);
						// if (!containedNodeModulesWatchers?.has(key)) {
						//	 (containedNodeModulesWatchers ||= new Map()).set(
						//		 key,
						//		 host.watchNodeModulesForPackageJsonChanges(nodeModulesPath),
						//	 );
						// }
					}
				}
			}
		},
		setModulePaths(fromFileName, toFileName, preferences, options, modulePaths) {
			const cache = ensureCache(fromFileName, preferences, options);
			const info = cache.get(toFileName);
			if (info) {
				info.modulePaths = modulePaths;
			}
			else {
				cache.set(toFileName, createInfo(/*kind*/ undefined, modulePaths, /*moduleSpecifiers*/ undefined, /*packageName */undefined,/*isBlockedByPackageJsonDependencies*/ undefined));
			}
		},
		setBlockedByPackageJsonDependencies(fromFileName, toFileName, preferences, options, packageName, isBlockedByPackageJsonDependencies) {
			const cache = ensureCache(fromFileName, preferences, options);
			const info = cache.get(toFileName);
			if (info) {
				info.isBlockedByPackageJsonDependencies = isBlockedByPackageJsonDependencies;
                info.packageName = packageName;
			}
			else {
				cache.set(toFileName, createInfo(/*kind*/ undefined, /*modulePaths*/ undefined, /*moduleSpecifiers*/ undefined, /*packageName */undefined, isBlockedByPackageJsonDependencies));
			}
		},
		clear() {
			containedNodeModulesWatchers?.forEach(watcher => watcher.close());
			cache?.clear();
			containedNodeModulesWatchers?.clear();
			currentKey = undefined;
		},
		count() {
			return cache ? cache.size : 0;
		}
	};
	// if (Debug.isDebugging) {
	//	 Object.defineProperty(result, "__cache", { get: () => cache });
	// }
	return result;

	function ensureCache(fromFileName: Path, preferences: UserPreferences, options: ModuleSpecifierOptions) {
		const newKey = key(fromFileName, preferences, options);
		if (cache && (currentKey !== newKey)) {
			result.clear();
		}
		currentKey = newKey;
		return cache ||= new Map();
	}

	function key(fromFileName: Path, preferences: UserPreferences, options: ModuleSpecifierOptions) {
		return `${fromFileName},${preferences.importModuleSpecifierEnding},${preferences.importModuleSpecifierPreference},${options.overrideImportMode}`;
	}

	function createInfo(
		kind: ResolvedModuleSpecifierInfo["kind"] | undefined,
		modulePaths: readonly ModulePath[] | undefined,
		moduleSpecifiers: readonly string[] | undefined,
        packageName: string | undefined,
		isBlockedByPackageJsonDependencies: boolean | undefined,
	): ResolvedModuleSpecifierInfo {
		return { kind, modulePaths, moduleSpecifiers, packageName, isBlockedByPackageJsonDependencies };
	}
}
