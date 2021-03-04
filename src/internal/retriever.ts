import * as core from '@actions/core'
import {HttpClient, HttpClientError} from '@actions/http-client'
import {BasicCredentialHandler} from '@actions/http-client/auth'
import {IRequestHandler} from '@actions/http-client/interfaces'
import {retry} from 'ts-retry-promise'
import * as xml2js from 'xml-js'
import {ElementCompact} from 'xml-js'
import {lastVersionByNumber} from './lastVersionByNumber'
import {compareVersionsDesc, Version} from './Version'

const REPOSITORY_ALIASES: { [key: string]: string } = {
    'central': 'https://repo1.maven.org/maven2/',
    'oss-snapshots': 'https://oss.sonatype.org/content/repositories/snapshots/',
}

export function resolveRepositoryAlias(repositoryUrl: string): string {
    const aliasUrl = REPOSITORY_ALIASES[repositoryUrl.toLowerCase()]
    if (aliasUrl != null) {
        return aliasUrl
    } else {
        return repositoryUrl
    }
}


export interface MavenArtifactVersions {
    stable: readonly Version[]
    unstable: readonly Version[]
    latestStable: Version | undefined
    latestUnstable: Version | undefined
    stableMajors: readonly Version[]
    unstableMajors: readonly Version[]
    stableMinors: readonly Version[]
    unstableMinors: readonly Version[]
}

const timeoutBetweenRetries = process.env.NODE_ENV !== 'test' ? 5_000 : 0

export async function retrieveMavenArtifactVersions(
    artifactGroup: string,
    artifactName: string,
    repositoryUrl: string,
    repositoryUser?: string,
    repositoryPassword?: string,
    minVersion?: Version,
    maxVersion?: Version
): Promise<MavenArtifactVersions> {
    core.info(`Retrieving ${artifactGroup}:${artifactName} versions from ${repositoryUrl}`)

    repositoryUrl = resolveRepositoryAlias(repositoryUrl
        .replace(/\?+.*/, '')
        .replace(/#+.*/, '')
    )
    core.debug(`True repository URL: ${repositoryUrl}`)

    const mavenMetadataXmlUrl = [
        repositoryUrl.replace(/\/+$/, ''),
        artifactGroup.replace(/\./g, '/'),
        artifactName,
        'maven-metadata.xml',
    ].join('/')
    core.info(`Retrieving maven-metadata.xml: ${mavenMetadataXmlUrl}`)

    const requestHandlers: IRequestHandler[] = []
    if (repositoryUser || repositoryPassword) {
        requestHandlers.push(new BasicCredentialHandler(repositoryUser || '', repositoryPassword || ''))
    }

    const httpClient = new HttpClient('retrieve-maven-artifact-versions', requestHandlers)
    return retry(
        () => httpClient.get(mavenMetadataXmlUrl, {
            'Accept-Encoding': 'identity',
        })
            .then(resp => {
                const statusCode = resp.message.statusCode
                if (statusCode != null && statusCode >= 200 && statusCode < 300) {
                    return resp
                } else {
                    throw new HttpClientError(
                        `Request failed with status ${statusCode}`,
                        statusCode || NaN
                    )
                }
            }),
        {
            retries: 2,
            delay: timeoutBetweenRetries,
        }
    )
        .then(response => response.readBody())
        .then(content => {
            const root = xml2js.xml2js(content, {
                trim: true,
                compact: true,
                ignoreDoctype: true,
                ignoreComment: true,
            }) as ElementCompact

            core.debug(JSON.stringify(root, null, 2))

            let versions = toArray(root.metadata?.versioning?.versions?.version)
                .map((node, index) => {
                    const ver = Version.parse(node._text)
                    if (ver == null) {
                        core.warning(`Invalid version at index ${index}: ${JSON.stringify(node, null, 2)}`)
                    }
                    return ver
                })
                .filter(ver => ver != null) as Version[]

            if (minVersion || maxVersion) {
                const filter: (string) => boolean = version => {
                    version = version.split('-')[0]
                    if (minVersion && minVersion.compareTo(version) > 0) {
                        return false
                    }
                    if (maxVersion && maxVersion.compareTo(version) < 0) {
                        return false
                    }
                    return true
                }
                versions = versions.filter(filter)
            }

            versions.sort(compareVersionsDesc)

            const stable = versions.filter(ver => ver.isRelease)
            const unstable = versions

            return {
                stable,
                unstable,
                latestStable: stable.find(() => true),
                latestUnstable: unstable.find(() => true),
                stableMajors: lastVersionByNumber(stable, 2),
                unstableMajors: lastVersionByNumber(unstable, 2),
                stableMinors: lastVersionByNumber(stable, 3),
                unstableMinors: lastVersionByNumber(unstable, 3),
            }
        })
        .finally(() => httpClient.dispose())
}


function toArray<T>(obj: T | T[] | undefined): T[] {
    if (obj == null) {
        return []
    } else if (Array.isArray(obj)) {
        return obj
    } else {
        return [obj]
    }
}
