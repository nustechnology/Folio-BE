import SpaceRepository from '~/prisma/repositories/space.repository';

type ListOptions = {
  search?: string;
  sort: 'recently-updated' | 'recently-created' | 'alphabetical-az' | 'alphabetical-za';
};

const list = async (ownerId: string, options: ListOptions) => {
  return SpaceRepository.findManyByOwner({ ownerId }, options);
};

export default {
  list,
};
