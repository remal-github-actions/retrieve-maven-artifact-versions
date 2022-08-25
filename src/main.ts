import * as core from '@actions/core'
import {retrieveMavenArtifactVersions} from './internal/retriever'
import {Version} from './internal/Version'

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

async function run(): Promise<void> {
    try {
        const artifactGroup = core.getInput('group', {required: true}).trim()
        const artifactName = core.getInput('name', {required: true}).trim()

        const repositoryUrl = core.getInput('repository', {required: false}).trim()

        const repositoryUser = core.getInput('user')
        if (repositoryUser) {
            core.setSecret(repositoryUser)
        }
        const repositoryPassword = core.getInput('password')
        if (repositoryPassword) {
            core.setSecret(repositoryPassword)
        }

        const minVersions = core.getInput('min').split(/[,;]/)
            .map(it => it.trim())
            .filter(it => it.length)
            .map(Version.parse)
            .filter(it => it != null) as Version[]

        const maxVersions = core.getInput('max').split(/[,;]/)
            .map(it => it.trim())
            .filter(it => it.length)
            .map(Version.parse)
            .filter(it => it != null) as Version[]

        const excludedVersions = core.getInput('exclude').split(/[,;]/)
            .map(it => it.trim())
            .filter(it => it.length)
            .map(Version.parse)
            .filter(it => it != null) as Version[]

        const versions = await retrieveMavenArtifactVersions(
            artifactGroup,
            artifactName,
            repositoryUrl,
            repositoryUser,
            repositoryPassword,
            minVersions,
            maxVersions,
            excludedVersions
        )

        Object.entries(versions).forEach(([key, value]) => {
            if (value == null) {
                // skip NULLs
            } else if (Array.isArray(value)) {
                core.info(`${key}: ${value.join(', ')}`)
                core.setOutput(key, JSON.stringify(value, (__, obj) => {
                    if (obj instanceof Version) {
                        return obj.toString()
                    } else {
                        return obj
                    }
                }))
            } else {
                core.info(`${key}: ${value}`)
                core.setOutput(key, value.toString())
            }
        })


    } catch (error) {
        core.setFailed(error instanceof Error ? error : (error as object).toString())
    }
}

//noinspection JSIgnoredPromiseFromCall
run()
