import * as core from '@actions/core'
import {retrieveMavenArtifactVersions} from './internal/retriever'
import {Version} from './internal/Version'

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

async function run(): Promise<void> {
    try {
        const artifactGroup = core.getInput('group', {required: true})
        const artifactName = core.getInput('name', {required: true})

        const repositoryUrl = core.getInput('repository', {required: false})

        const repositoryUser = core.getInput('user')
        if (repositoryUser) {
            core.setSecret(repositoryUser)
        }
        const repositoryPassword = core.getInput('password')
        if (repositoryPassword) {
            core.setSecret(repositoryPassword)
        }

        const minVersion = Version.parse(core.getInput('min'))
        const maxVersion = Version.parse(core.getInput('max'))

        const versions = await retrieveMavenArtifactVersions(
            artifactGroup,
            artifactName,
            repositoryUrl,
            repositoryUser,
            repositoryPassword,
            minVersion,
            maxVersion
        )

        Object.entries(versions).forEach(([key, value]) => {
            if (value == null) {
                // skip NULLs
            } else if (Array.isArray(value)) {
                core.info(`${key}: ${value.join(', ')}`)
                core.setOutput(key, JSON.stringify(value))
            } else {
                core.info(`${key}: ${value}`)
                core.setOutput(key, value.toString())
            }
        })


    } catch (error) {
        core.setFailed(error)
    }
}

//noinspection JSIgnoredPromiseFromCall
run()
