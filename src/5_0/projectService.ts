import type { Path, System, server, LanguageServiceMode, UserPreferences } from 'typescript/lib/tsserverlibrary';
import { createPackageJsonCache, PackageJsonCache, Ternary, ProjectPackageJsonInfo } from './packageJsonCache';

export type ProjectService = ReturnType<typeof createProjectService>;

type NormalizedPath = server.NormalizedPath;

export const enum PackageJsonAutoImportPreference {
	Off,
	On,
	Auto,
}

export function createProjectService(
	ts: typeof import('typescript/lib/tsserverlibrary'),
	sys: System,
	currentDirectory: string,
	hostConfiguration: { preferences: UserPreferences; },
	serverMode: LanguageServiceMode,
) {
	const {
		toPath,
		getNormalizedAbsolutePath,
		normalizePath: toNormalizedPath,
		createGetCanonicalFileName,
		forEachAncestorDirectory,
		getDirectoryPath,
	} = ts as any;

	const projectService = {
		serverMode,
		host: sys,
		currentDirectory: toNormalizedPath(currentDirectory),
		toCanonicalFileName: createGetCanonicalFileName(sys.useCaseSensitiveFileNames),
		toPath(fileName: string) {
			return toPath(fileName, this.currentDirectory, this.toCanonicalFileName);
		},

		getExecutingFilePath() {
			return this.getNormalizedAbsolutePath(this.host.getExecutingFilePath());
		},

		getNormalizedAbsolutePath(fileName: string) {
			return getNormalizedAbsolutePath(fileName, this.host.getCurrentDirectory());
		},

		packageJsonCache: undefined as unknown as PackageJsonCache,
		getPackageJsonsVisibleToFile(fileName: string, rootDir?: string): readonly ProjectPackageJsonInfo[] {
			const packageJsonCache = this.packageJsonCache;
			const rootPath = rootDir && this.toPath(rootDir);
			const filePath = this.toPath(fileName);
			const result: ProjectPackageJsonInfo[] = [];
			const processDirectory = (directory: Path): boolean | undefined => {
				switch (packageJsonCache.directoryHasPackageJson(directory)) {
					// Sync and check same directory again
					case Ternary.Maybe:
						packageJsonCache.searchDirectoryAndAncestors(directory);
						return processDirectory(directory);
					// Check package.json
					case Ternary.True:
						// const packageJsonFileName = _combinePaths(directory, "package.json");
						// this.watchPackageJsonFile(packageJsonFileName as ts.Path); // TODO
						const info = packageJsonCache.getInDirectory(directory);
						if (info) result.push(info as any);
				}
				if (rootPath && rootPath === directory) {
					return true;
				}
			};

			forEachAncestorDirectory(getDirectoryPath(filePath), processDirectory);
			return result;
		},

		includePackageJsonAutoImports(): PackageJsonAutoImportPreference {
			switch (hostConfiguration.preferences.includePackageJsonAutoImports) {
				case 'on': return PackageJsonAutoImportPreference.On;
				case 'off': return PackageJsonAutoImportPreference.Off;
				default: return PackageJsonAutoImportPreference.Auto;
			}
		},

		fileExists(fileName: NormalizedPath): boolean {
			return this.host.fileExists(fileName);
		},
	};

	projectService.packageJsonCache = createPackageJsonCache(ts, projectService);
	return projectService;
}
