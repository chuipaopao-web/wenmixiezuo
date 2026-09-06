import { openingTaxonomySchema, type OpeningTaxonomy } from "@wenmi-rebuild/contracts";
import { OPENING_TAXONOMY as SOURCE_OPENING_TAXONOMY } from "./taxonomy-source/opening-blueprint.js";

export const OPENING_TAXONOMY: OpeningTaxonomy = openingTaxonomySchema.parse({
  version: SOURCE_OPENING_TAXONOMY.version,
  categories: SOURCE_OPENING_TAXONOMY.categories.map((item) => ({
    key: item.key,
    name: item.name,
    channel: item.channel,
    description: item.description,
    recommendedMainTags: [...item.recommendedMainTags],
    tagPackKeys: [...item.tagPackKeys]
  })),
  subjects: SOURCE_OPENING_TAXONOMY.subjects.map((item) => ({
    name: item.name,
    packKeys: [...item.packKeys]
  })),
  mainTags: [...SOURCE_OPENING_TAXONOMY.mainTags],
  personalityGroups: SOURCE_OPENING_TAXONOMY.personalityGroups.map((item) => ({
    key: item.key,
    name: item.name,
    description: item.description,
    options: [...item.options]
  })),
  boundaryGroups: SOURCE_OPENING_TAXONOMY.boundaryGroups.map((item) => ({
    name: item.name,
    description: item.description,
    options: [...item.options]
  })),
  tagGroups: SOURCE_OPENING_TAXONOMY.tagGroups.map((item) => ({
    key: item.key,
    name: item.name,
    description: item.description,
    packKeys: [...item.packKeys],
    mainTags: [...item.mainTags],
    auxiliaryTags: [...item.auxiliaryTags],
    storyTraits: [...item.storyTraits]
  }))
});

export const SOURCE_TAXONOMY_USED_FIELDS = {
  version: SOURCE_OPENING_TAXONOMY.version,
  categories: SOURCE_OPENING_TAXONOMY.categories,
  subjects: SOURCE_OPENING_TAXONOMY.subjects,
  mainTags: SOURCE_OPENING_TAXONOMY.mainTags,
  personalityGroups: SOURCE_OPENING_TAXONOMY.personalityGroups,
  boundaryGroups: SOURCE_OPENING_TAXONOMY.boundaryGroups,
  tagGroups: SOURCE_OPENING_TAXONOMY.tagGroups
};
