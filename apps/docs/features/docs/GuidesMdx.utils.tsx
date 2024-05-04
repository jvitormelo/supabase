import matter from 'gray-matter'
import { type Metadata, type ResolvingMetadata } from 'next'
import { redirect } from 'next/navigation'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, sep } from 'node:path'
import { existsFile } from '~/features/helpers.fs'
import type { OrPromise } from '~/features/helpers.types'
import { notFoundLink } from '~/features/recommendations/NotFound.utils'
import { BASE_PATH, MISC_URL } from '~/lib/constants'
import { GUIDES_DIRECTORY, isValidGuideFrontmatter, type GuideFrontmatter } from '~/lib/docs'
import { newEditLink } from './GuidesMdx.template'

/**
 * [TODO Charis]
 *
 * This is kind of a dumb place for this to be, clean up later as part of
 * cleaning up navigation menus.
 */
const PUBLISHED_SECTIONS = [
  'ai',
  'api',
  'auth',
  'cli',
  'database',
  'functions',
  'getting-started',
  // 'graphql', -- technically published, but completely federated
  'platform',
  'realtime',
  'resources',
  'self-hosting',
  'storage',
] as const

const getGuidesMarkdownInternal = async ({ slug }: { slug: string[] }) => {
  const relPath = slug.join(sep).replace(/\/$/, '')
  const fullPath = join(GUIDES_DIRECTORY, relPath + '.mdx')
  /**
   * SAFETY CHECK:
   * Prevent accessing anything outside of published sections and GUIDES_DIRECTORY
   */
  if (
    !fullPath.startsWith(GUIDES_DIRECTORY) ||
    !PUBLISHED_SECTIONS.some((section) => relPath.startsWith(section))
  ) {
    redirect(notFoundLink(slug.join('/')))
  }

  const mdx = await readFile(fullPath, 'utf-8')

  const editLink = newEditLink(
    `supabase/supabase/blob/master/apps/docs/content/guides/${relPath}.mdx`
  )

  const { data: meta, content } = matter(mdx)
  if (!isValidGuideFrontmatter(meta)) {
    throw Error('Type of frontmatter is not valid')
  }

  return {
    pathname: `/guides/${slug.join('/')}` satisfies `/${string}`,
    meta,
    content,
    editLink,
  }
}

/**
 * Caching this for the entire process is fine because the Markdown content is
 * baked into each deployment and cannot change. There's also nothing sensitive
 * here: this is just reading the MDX files from our GitHub repo.
 */
const cache = <Args extends unknown[], Output>(fn: (...args: Args) => Promise<Output>) => {
  const _cache = new Map<string, Output>()
  return async (...args: Args) => {
    /**
     * This is rough but will do because it's just the params object.
     */
    const cacheKey = JSON.stringify(args)
    if (!_cache.has(cacheKey)) {
      _cache.set(cacheKey, await fn(...args))
    }
    return _cache.get(cacheKey)!
  }
}
const getGuidesMarkdown = cache(getGuidesMarkdownInternal)

const genGuidesStaticParams = (directory?: string) => async () => {
  const promises = directory
    ? (await readdir(join(GUIDES_DIRECTORY, directory), { recursive: true }))
        .filter((file) => extname(file) === '.mdx')
        .map((file) => ({ slug: file.replace(/\.mdx$/, '').split(sep) }))
    : PUBLISHED_SECTIONS.map(async (section) =>
        (await readdir(join(GUIDES_DIRECTORY, section), { recursive: true }))
          .filter((file) => extname(file) === '.mdx')
          .map((file) => ({
            slug: [section, ...file.replace(/\.mdx$/, '').split(sep)],
          }))
          .concat(
            (await existsFile(join(GUIDES_DIRECTORY, `${section}.mdx`)))
              ? [{ slug: [section] }]
              : []
          )
      )

  /**
   * Flattening earlier will not work because there is nothing to flatten
   * until the promises resolve.
   */
  const result = (await Promise.all(promises)).flat()
  return result
}

const pluckPromise = <T, K extends keyof T>(promise: Promise<T>, key: K) =>
  promise.then((data) => data[key])

const genGuideMeta =
  <Params,>(
    generate: (params: Params) => OrPromise<{ meta: GuideFrontmatter; pathname: `/${string}` }>
  ) =>
  async ({ params }: { params: Params }, parent: ResolvingMetadata): Promise<Metadata> => {
    const [parentAlternates, parentOg, { meta, pathname }] = await Promise.all([
      pluckPromise(parent, 'alternates'),
      pluckPromise(parent, 'openGraph'),
      generate(params),
    ])

    // Pathname has form `/guides/(section)/**`
    const ogType = pathname.split('/')[2]

    return {
      title: `${meta.title} | Supabase Docs`,
      description: meta.description || meta.subtitle,
      // @ts-ignore
      alternates: {
        ...parentAlternates,
        canonical: meta.canonical || `${BASE_PATH}${pathname}`,
      },
      openGraph: {
        ...parentOg,
        url: `${BASE_PATH}${pathname}`,
        images: {
          url: `${MISC_URL}/functions/v1/og-images?site=docs&type=${encodeURIComponent(ogType)}&title=${encodeURIComponent(meta.title)}&description=${encodeURIComponent(meta.description ?? 'undefined')}`,
          width: 800,
          height: 600,
          alt: meta.title,
        },
      },
    }
  }

export { getGuidesMarkdown, genGuidesStaticParams, genGuideMeta }
