import type { LanguageService, LanguageServiceHost } from 'typescript/lib/tsserverlibrary';
import _50 from '../5_0';
import { createProject } from './project';

export default function (
	ts: typeof import('typescript/lib/tsserverlibrary'),
	sys: import('typescript/lib/tsserverlibrary').System,
	host: LanguageServiceHost,
	createLanguageService: (host: LanguageServiceHost) => LanguageService
) {
	return _50(ts, sys, host, createLanguageService, createProject);
}
