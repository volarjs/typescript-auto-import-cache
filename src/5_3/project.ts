import type { LanguageService, LanguageServiceHost } from 'typescript/lib/tsserverlibrary';
import { ProjectOptions, createProject as _createProject } from '../5_0/project';
import { SymlinkCache } from './symlinkCache';

export function createProject(
	ts: typeof import('typescript/lib/tsserverlibrary'),
	host: LanguageServiceHost,
	createLanguageService: (host: LanguageServiceHost) => LanguageService,
	options: ProjectOptions
) {
	const { createSymlinkCache, ensureTrailingDirectorySeparator } = ts as any;
	const project = _createProject(ts, host, createLanguageService, options);
	project.getSymlinkCache = () => {
		if (!project.symlinks) {
			project.symlinks = createSymlinkCache(project.getCurrentDirectory(), project.getCanonicalFileName);
			const setSymlinkedDirectory = project.symlinks!.setSymlinkedDirectory;
			project.symlinks!.setSymlinkedDirectory = (symlink, real) => {
				if (typeof real === 'object') {
					real.real = ensureTrailingDirectorySeparator(real.real);
					real.realPath = ensureTrailingDirectorySeparator(real.realPath);
				}
				setSymlinkedDirectory(symlink, real);
			};
		}
		if (project.program && !(project.symlinks as unknown as SymlinkCache).hasProcessedResolutions()) {
			(project.symlinks as unknown as SymlinkCache).setSymlinksFromResolutions(
				// @ts-expect-error
				project.program.forEachResolvedModule,
				// @ts-expect-error
				project.program.forEachResolvedTypeReferenceDirective,
				// @ts-expect-error
				project.program.getAutomaticTypeDirectiveResolutions(),
			);
		}
		return project.symlinks!;
	};
	return project;
}
