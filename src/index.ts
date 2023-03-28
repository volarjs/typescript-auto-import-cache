import * as semver from 'semver';
import type * as ts from 'typescript/lib/tsserverlibrary';
import _40 from './4_0';
import _44 from './4_4';
import _47 from './4_7';
import _50 from './5_0';

export function createLanguageService(
	ts: typeof import('typescript/lib/tsserverlibrary'),
	host: ts.LanguageServiceHost | undefined,
	createLanguageService: (host: ts.LanguageServiceHost) => ts.LanguageService | undefined,
	rootDirectory: string
): ts.LanguageService | undefined {
	if (!host) return undefined
	if (semver.gte(ts.version, '5.0.0')) {
		return _50(ts, host, createLanguageService, rootDirectory);
	} 
	else if (semver.gte(ts.version, '4.7.0')) {
		const service = createLanguageService(host)
		if (!service) return undefined
		_47(ts, host, service);
		return service
	}
	else if (semver.gte(ts.version, '4.4.0')) {
		const service = createLanguageService(host)
		if (!service) return undefined
		_44(ts, host, service);
		return service
	}
	else if (semver.gte(ts.version, '4.0.0')) {
		const service = createLanguageService(host)
		if (!service) return undefined
		_40(ts, host, service);
		return service
	}
	return createLanguageService(host)
}
