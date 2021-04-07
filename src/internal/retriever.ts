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
    latestStable: Version | undefined
    latestUnstable: Version | undefined
    stable: readonly Version[]
    stableAndLatestUnstable: readonly Version[]
    unstable: readonly Version[]
    stableMajors: readonly Version[]
    stableMajorsAndLatestUnstable: readonly Version[]
    unstableMajors: readonly Version[]
    stableMinors: readonly Version[]
    stableMinorAndLatestUnstable: readonly Version[]
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
        const authHandler = new BasicCredentialHandler(repositoryUser || '', repositoryPassword || '')
        requestHandlers.push(authHandler)

        const options = {headers: {}}
        authHandler.prepareRequest(options)
        Object.entries(options.headers).forEach(([key, value]) => {
            if (key != null && key.toLowerCase() === 'authorization') {
                const valueStr = (value as any)?.toString() || ''
                if (valueStr.length) {
                    core.setSecret(valueStr)
                }
            }
        })
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
                } else if (statusCode === 404) {
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
        .then(response => {
            const statusCode = response.message.statusCode!
            if (statusCode === 404) {
                return '<metadata/>'
            }
            return response.readBody()
        })
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

            const stableMajors = lastVersionByNumber(stable, 2)
            const unstableMajors = lastVersionByNumber(unstable, 2)
            const stableMinors = lastVersionByNumber(stable, 3)
            const unstableMinors = lastVersionByNumber(unstable, 3)

            const stableAndLatestUnstable: Version[] = [...stable]
            const stableMajorsAndLatestUnstable: Version[] = [...stableMajors]
            const stableMinorAndLatestUnstable: Version[] = [...stableMinors]
            const latestStable = stable.length ? stable[0] : undefined
            if (latestStable != null) {
                const latestUnstable = unstable.find(ver => !ver.isRelease && ver.compareTo(latestStable) > 0)
                if (latestUnstable != null) {
                    stableAndLatestUnstable.unshift(latestUnstable)
                    stableMajorsAndLatestUnstable.unshift(latestUnstable)
                    stableMinorAndLatestUnstable.unshift(latestUnstable)
                }
            } else {
                const latestUnstable = unstable.find(ver => !ver.isRelease)
                if (latestUnstable != null) {
                    stableAndLatestUnstable.unshift(latestUnstable)
                    stableMajorsAndLatestUnstable.unshift(latestUnstable)
                    stableMinorAndLatestUnstable.unshift(latestUnstable)
                }
            }

            return {
                latestStable: stable.find(() => true),
                latestUnstable: unstable.find(() => true),
                stable,
                stableAndLatestUnstable,
                unstable,
                stableMajors,
                stableMajorsAndLatestUnstable,
                unstableMajors,
                stableMinors,
                stableMinorAndLatestUnstable,
                unstableMinors,
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
