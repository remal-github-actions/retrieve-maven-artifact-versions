import nock from 'nock'
import {resolveRepositoryAlias, retrieveMavenArtifactVersions} from './retriever'
import {Version} from './Version'

describe('retriever', () => {

    beforeAll(nock.disableNetConnect)
    afterAll(nock.restore)

    afterEach(nock.cleanAll)

    it('positive scenario', () => {
        nock('https://repo1.maven.org').persist()
            .get('/maven2/org/springframework/boot/spring.core/maven-metadata.xml')
            .reply(200, `
                <metadata modelVersion="1.1.0">
                    <groupId>org.springframework</groupId>
                    <artifactId>spring.core</artifactId>
                    <versioning>
                        <versions>
                            <version>1.0-rc1</version>
                            <version>1.0</version>
                            <version>1.2-rc1</version>
                            <version>1.2-rc2</version>
                            <version>2.0-m1</version>
                            <version>2.0.3</version>
                            <version>2.5.6.SEC01</version>
                            <version>5.2.0.RELEASE</version>
                            <version>5.3.0-CR1</version>
                            <version>5.3.0-CR2</version>
                        </versions>
                    </versioning>
                </metadata>
            `)

        return retrieveMavenArtifactVersions(
            'org.springframework.boot',
            'spring.core',
            'https://repo1.maven.org/maven2/'
        )
            .then(versions => {
                expect(versions.latestStable).toStrictEqual(new Version('5.2.0.RELEASE'))
                expect(versions.latestUnstable).toStrictEqual(new Version('5.3.0-CR2'))

                expect(versions.stable).toStrictEqual([
                    new Version('5.2.0.RELEASE'),
                    new Version('2.0.3'),
                    new Version('1.0'),
                ])
                expect(versions.stableAndLatestUnstable).toStrictEqual([
                    new Version('5.3.0-CR2'),
                    new Version('5.2.0.RELEASE'),
                    new Version('2.0.3'),
                    new Version('1.0'),
                ])
                expect(versions.unstable).toStrictEqual([
                    new Version('5.3.0-CR2'),
                    new Version('5.3.0-CR1'),
                    new Version('5.2.0.RELEASE'),
                    new Version('2.5.6.SEC01'),
                    new Version('2.0.3'),
                    new Version('2.0-m1'),
                    new Version('1.2-rc2'),
                    new Version('1.2-rc1'),
                    new Version('1.0'),
                    new Version('1.0-rc1'),
                ])

                expect(versions.stableMajors).toStrictEqual([
                    new Version('5.2.0.RELEASE'),
                    new Version('2.0.3'),
                    new Version('1.0'),
                ])
                expect(versions.stableMajorsAndLatestUnstable).toStrictEqual([
                    new Version('5.3.0-CR2'),
                    new Version('5.2.0.RELEASE'),
                    new Version('2.0.3'),
                    new Version('1.0'),
                ])
                expect(versions.unstableMajors).toStrictEqual([
                    new Version('5.3.0-CR2'),
                    new Version('2.5.6.SEC01'),
                    new Version('1.2-rc2'),
                ])

                expect(versions.stableMinors).toStrictEqual([
                    new Version('5.2.0.RELEASE'),
                    new Version('2.0.3'),
                    new Version('1.0'),
                ])
                expect(versions.stableMinorAndLatestUnstable).toStrictEqual([
                    new Version('5.3.0-CR2'),
                    new Version('5.2.0.RELEASE'),
                    new Version('2.0.3'),
                    new Version('1.0'),
                ])
                expect(versions.unstableMinors).toStrictEqual([
                    new Version('5.3.0-CR2'),
                    new Version('5.2.0.RELEASE'),
                    new Version('2.5.6.SEC01'),
                    new Version('2.0.3'),
                    new Version('1.2-rc2'),
                    new Version('1.0'),
                ])
            })
    })

    it('404 status', () => {
        nock('https://repo1.maven.org').persist()
            .get('/maven2/org/springframework/boot/spring.core/maven-metadata.xml')
            .reply(404, 'Not Found')

        return retrieveMavenArtifactVersions(
            'org.springframework.boot',
            'spring.core',
            'https://repo1.maven.org/maven2/'
        )
            .then(versions => {
                expect(versions.latestStable).toBeUndefined()
                expect(versions.latestUnstable).toBeUndefined()

                expect(versions.stable).toStrictEqual([])
                expect(versions.stableAndLatestUnstable).toStrictEqual([])
                expect(versions.unstable).toStrictEqual([])

                expect(versions.stableMajors).toStrictEqual([])
                expect(versions.stableMajorsAndLatestUnstable).toStrictEqual([])
                expect(versions.unstableMajors).toStrictEqual([])

                expect(versions.stableMinors).toStrictEqual([])
                expect(versions.stableMinorAndLatestUnstable).toStrictEqual([])
                expect(versions.unstableMinors).toStrictEqual([])
            })
    })

    it('server error', () => {
        let requestsCount = 0
        nock('https://repo1.maven.org').persist()
            .get('/maven2/org/springframework/boot/spring.core/maven-metadata.xml')
            .reply(500)
            .on('request', () =>
                ++requestsCount
            )

        return retrieveMavenArtifactVersions(
            'org.springframework.boot',
            'spring.core',
            'https://repo1.maven.org/maven2/'
        )
            .then(exceptionExpected)
            .catch(exceptionExpected)
            .finally(() => expect(requestsCount).toBe(3))
    })


    it('resolveRepositoryAlias', () => {
        expect(resolveRepositoryAlias('central'))
            .toBe('https://repo1.maven.org/maven2/')

        expect(resolveRepositoryAlias('oss-snapshots'))
            .toBe('https://oss.sonatype.org/content/repositories/snapshots/')

        expect(resolveRepositoryAlias('https://oss.sonatype.org/content/repositories/releases/'))
            .toBe('https://oss.sonatype.org/content/repositories/releases/')

        expect(resolveRepositoryAlias('ggg'))
            .toBe('ggg')
    })

})

function exceptionExpected(data) {
    if (data instanceof Error) {
        // OK
    } else {
        throw new Error('exception expected')
    }
}
