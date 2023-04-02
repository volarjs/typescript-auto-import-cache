import type { Path } from 'typescript/lib/tsserverlibrary';
import type { ProjectService } from './projectService';

interface PackageJsonPathFields {
	typings?: string;
	types?: string;
	typesVersions?: Map<string, Map<string, string[]>>;
	main?: string;
	tsconfig?: string;
	type?: string;
	imports?: object;
	exports?: object;
	name?: string;
}

interface VersionPaths {
	version: string;
	paths: Map<string, string[]>;
}

/** @internal */
export interface PackageJsonInfo {
	packageDirectory: string;
	contents: PackageJsonInfoContents;
}
/** @internal */
export interface PackageJsonInfoContents {
	packageJsonContent: PackageJsonPathFields;
	/** false: versionPaths are not present. undefined: not yet resolved */
	versionPaths: VersionPaths | false | undefined;
	/** false: resolved to nothing. undefined: not yet resolved */
	resolvedEntrypoints: string[] | false | undefined;
}

/** @internal */
export const enum PackageJsonDependencyGroup {
	Dependencies = 1 << 0,
	DevDependencies = 1 << 1,
	PeerDependencies = 1 << 2,
	OptionalDependencies = 1 << 3,
	All = Dependencies | DevDependencies | PeerDependencies | OptionalDependencies,
}

/** @internal */
export interface ProjectPackageJsonInfo {
	fileName: string;
	parseable: boolean;
	dependencies?: Map<string, string>;
	devDependencies?: Map<string, string>;
	peerDependencies?: Map<string, string>;
	optionalDependencies?: Map<string, string>;
	get(dependencyName: string, inGroups?: PackageJsonDependencyGroup): string | undefined;
	has(dependencyName: string, inGroups?: PackageJsonDependencyGroup): boolean;
}
export interface ProjectPackageJsonInfo {
	fileName: string;
	parseable: boolean;
	dependencies?: Map<string, string>;
	devDependencies?: Map<string, string>;
	peerDependencies?: Map<string, string>;
	optionalDependencies?: Map<string, string>;
	get(dependencyName: string, inGroups?: PackageJsonDependencyGroup): string | undefined;
	has(dependencyName: string, inGroups?: PackageJsonDependencyGroup): boolean;
}

export interface PackageJsonCache {
	addOrUpdate(fileName: Path): void;
	forEach(action: (info: ProjectPackageJsonInfo, fileName: Path) => void): void;
	delete(fileName: Path): void;
	get(fileName: Path): ProjectPackageJsonInfo | false | undefined;
	getInDirectory(directory: Path): ProjectPackageJsonInfo | undefined;
	directoryHasPackageJson(directory: Path): Ternary;
	searchDirectoryAndAncestors(directory: Path): void;
}

export const enum Ternary {
	False = 0,
	Unknown = 1,
	Maybe = 3,
	True = -1,
}

export function createPackageJsonCache(ts: typeof import('typescript/lib/tsserverlibrary'), host: ProjectService): PackageJsonCache {
	const { createPackageJsonInfo, getDirectoryPath, combinePaths, tryFileExists, forEachAncestorDirectory } = ts as any;
	const packageJsons = new Map<string, ProjectPackageJsonInfo>();
	const directoriesWithoutPackageJson = new Map<string, true>();
	return {
		addOrUpdate,
		// @ts-expect-error
		forEach: packageJsons.forEach.bind(packageJsons),
		get: packageJsons.get.bind(packageJsons),
		delete: (fileName) => {
			packageJsons.delete(fileName);
			directoriesWithoutPackageJson.set(getDirectoryPath(fileName), true);
		},
		getInDirectory: (directory) => {
			return packageJsons.get(combinePaths(directory, 'package.json')) || undefined;
		},
		directoryHasPackageJson,
		searchDirectoryAndAncestors: (directory) => {
			// @ts-expect-error
			forEachAncestorDirectory(directory, (ancestor) => {
				if (directoryHasPackageJson(ancestor) !== Ternary.Maybe) {
					return true;
				}
				const packageJsonFileName = host.toPath(combinePaths(ancestor, 'package.json'));
				if (tryFileExists(host, packageJsonFileName)) {
					addOrUpdate(packageJsonFileName);
				} else {
					directoriesWithoutPackageJson.set(ancestor, true);
				}
			});
		},
	};

	function addOrUpdate(fileName: Path) {
		const packageJsonInfo = /*Debug.checkDefined( */ createPackageJsonInfo(fileName, host.host); /*);*/
		packageJsons.set(fileName, packageJsonInfo);
		directoriesWithoutPackageJson.delete(getDirectoryPath(fileName));
	}

	function directoryHasPackageJson(directory: Path) {
		return packageJsons.has(combinePaths(directory, 'package.json'))
			? Ternary.True
			: directoriesWithoutPackageJson.has(directory)
				? Ternary.False
				: Ternary.Maybe;
	}
}
