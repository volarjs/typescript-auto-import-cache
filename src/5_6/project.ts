import type { LanguageService, LanguageServiceHost } from 'typescript/lib/tsserverlibrary';
import { ProjectOptions } from '../5_0/project';
import { createProject as _createProject } from '../5_3/project';
import { createModuleSpecifierCache } from './moduleSpecifierCache';

export function createProject(
	ts: typeof import('typescript/lib/tsserverlibrary'),
	host: LanguageServiceHost,
	createLanguageService: (host: LanguageServiceHost) => LanguageService,
	options: ProjectOptions
) {
	// @ts-expect-error
	options.createModuleSpecifierCache = createModuleSpecifierCache;

	return _createProject(ts, host, createLanguageService, options);
}
