import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { remark } from 'remark';
import html from 'remark-html';
import gfm from 'remark-gfm';
import prism from 'remark-prism';
import { is_dev } from '@lib/env';

const postsDirectory = path.join(process.cwd(), 'posts');

const posts: { [key: string]: Post } = {};
import crypto from 'crypto';
function md5_hash(data: string): string {
  return crypto.createHash('md5').update(data ?? "").digest('hex');
}

const cacheFile = path.join(postsDirectory, 'cache.json');
function getCachedPost(filename: string, hash: string): Post | undefined {
  if (!fs.existsSync(cacheFile))
    return undefined;

  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  const cached_post = cache[filename];

  if (cached_post && cached_post.hash == hash) {
    // console.log("Cache hit for " + filename);
    delete cached_post.hash;
    return cached_post;
  }

  return undefined;
}

function storeCachedPost(post: Post, hash: string) {
  const cache: { [key: string]: CachedPost } = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  cache[post.filename] = {
    hash,
    ...post
  };
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
}


export interface PostMetaData {
  date: string,
  title: string,
  author: string,
  published: boolean,
  tags: string[],
  preview?: string,
  [key: string]: string | any | undefined
}

export interface Post extends PostMetaData {
  filename: string,
  content: string
}

export interface CachedPost extends Post {
  hash: string
}

const MAX_RECURSIVE_DEPTH = 3;
const MAX_PREVIEW_LENGTH  = 300;
const generatePreview = (preview: string | undefined, content: string) => {
  if (preview)
    return preview;

  var text = content;

  text = text.replaceAll(/<style[^>]*?>.*?<\/style>/gms, ''); // Remove Styles
  text = text.replaceAll(/<script[^>]*?>.*?<\/script>/gms, ''); // Remove Scripts
  for (var i = 0; i < MAX_RECURSIVE_DEPTH; i++)
    text = text.replaceAll(/<\/?[^>]*?>/gms, '');
  text.replaceAll(/\s+/gm, ' '); // Remove excess white space

  return text.length <= MAX_PREVIEW_LENGTH ? text : text.substring(0, MAX_PREVIEW_LENGTH - 3) + '...';
}

const fileExt = /\.md$/;

const markdown_pipeline = remark()
  .use(html, { sanitize: false })
  .use(gfm)
  .use(prism);

export function getPostFileNames() {
  return fs
    .readdirSync(postsDirectory)
    .filter(filename => fileExt.test(filename))
    .map(filename => filename.replace(fileExt, ''));
}

export async function getTags(): Promise<string[]> {
  const filenames = getPostFileNames();
  const post_promises = filenames.map(filename => getPost(filename))
  const posts = await Promise.all(post_promises)

  const tags = posts.filter(post => post.published || is_dev).reduce((tags, post) => {
    post.tags?.forEach(tag => {
      if (!tags.has(tag)) {
        tags.add(tag);
      }
    });
    return tags;
  }, new Set<string>());

  return Array.from(tags); // Allow unpublished posts in dev mode
}

export async function getPosts(): Promise<Post[]> {
  const filenames = getPostFileNames();
  const post_promises = filenames.map(filename => getPost(filename))
  const posts = await Promise.all(post_promises)

  return posts.filter(post => post.published || is_dev); // Allow unpublished posts in dev mode
}

const sortByDateDesc = (a: PostMetaData, b: PostMetaData) => (new Date(b.date)).getTime() - (new Date(a.date)).getTime();
export async function getSortedPosts(): Promise<PostMetaData[]> {
  const posts = await getPosts();
  return posts.sort(sortByDateDesc);
}

export async function getPostsByTag(tag: string): Promise<Post[]> {
  const posts = await getPosts();
  return posts.filter(post => post.published || is_dev).filter(post => post.tags?.includes(tag));
}

export async function getTagPaths(): Promise<{ params: { tag: string } }[]> {
  const tags = await getTags();
  return tags.map(tag => ({ params: { tag } }));
}

export async function getPostPaths(): Promise<{ params: { filename: string } }[]> {
  const posts = await getPosts();
  return posts.map(post => ({ params: { filename: post.filename } }));
}

export async function getPost(filename: string): Promise<Post> {
  const fullPath = path.join(postsDirectory, filename + ".md");
  const fileContents = await fs.promises.readFile(fullPath, 'utf8');
  
  const hash = md5_hash(fileContents);
  const cached_post = getCachedPost(filename, hash); 
  if (cached_post) return cached_post;
  
  const { content: rawContent, data: metadata }: { content: string, data: PostMetaData } = matter(fileContents) as any;
  const content = await markdown_pipeline.process(rawContent).then(result => result.toString());
  const post: Post = {
    filename,
    preview: generatePreview(metadata.preview, content),
    ...metadata,
    content,
  };

  storeCachedPost(post, hash);
  return post;
}