import * as semver from 'semver';
import type * as ts from 'typescript/lib/tsserverlibrary';
import _40 from './4_0';
import _44 from './4_4';
import _47 from './4_7';
import _50 from './5_0';

export { PackageJsonAutoImportPreference } from './5_0/projectService';

export function createLanguageService(
	ts: typeof import('typescript/lib/tsserverlibrary'),
	host: ts.LanguageServiceHost,
	createLanguageService: (host: ts.LanguageServiceHost) => ts.LanguageService,
	rootDirectory: string,
): {
	languageService: ts.LanguageService;
	setPreferences?(preferences: ts.UserPreferences): void;
	projectUpdated?(updatedProjectDirectory: string): void;
} {
	if (semver.gte(ts.version, '5.0.0')) {
		return _50(ts, host, createLanguageService, rootDirectory);
	}
	else if (semver.gte(ts.version, '4.7.0')) {
		const service = createLanguageService(host);
		_47(ts, host, service);
		return { languageService: service };
	}
	else if (semver.gte(ts.version, '4.4.0')) {
		const service = createLanguageService(host);
		_44(ts, host, service);
		return { languageService: service };
	}
	else if (semver.gte(ts.version, '4.0.0')) {
		const service = createLanguageService(host);
		_40(ts, host, service);
		return { languageService: service };
	}
	return { languageService: createLanguageService(host) };
}
