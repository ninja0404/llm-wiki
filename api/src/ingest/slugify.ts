const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'can',
  'of', 'in', 'to', 'for', 'with', 'on', 'at', 'from', 'by',
  'about', 'as', 'into', 'through', 'during', 'before', 'after',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
  'this', 'that', 'these', 'those', 'it', 'its',
]);

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter((word) => word && !STOP_WORDS.has(word))
    .join('-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
}

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

export function mergeEntitiesBySlug<
  T extends { slug: string; description: string; sourceChunkIds: string[]; confidence?: string },
>(entities: T[]): T[] {
  const map = new Map<string, T>();

  for (const entity of entities) {
    const existing = map.get(entity.slug);
    if (existing) {
      if (entity.description.length > existing.description.length) {
        existing.description = entity.description;
      }
      const chunkSet = new Set([...existing.sourceChunkIds, ...entity.sourceChunkIds]);
      existing.sourceChunkIds = [...chunkSet];
      const existingRank = CONFIDENCE_RANK[existing.confidence || 'low'] || 0;
      const newRank = CONFIDENCE_RANK[entity.confidence || 'low'] || 0;
      if (newRank > existingRank) {
        (existing as Record<string, unknown>).confidence = entity.confidence;
      }
    } else {
      map.set(entity.slug, { ...entity });
    }
  }

  return [...map.values()];
}
