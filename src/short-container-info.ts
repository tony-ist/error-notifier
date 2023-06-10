import { ContainerInfo } from 'dockerode';
import type { Event } from './types';

export interface ShortContainerInfo {
  id: string; // first 6 symbols of an actual container id
  imageName: string;
}

export function shortContainerInfoFromEvent(event: Event): ShortContainerInfo {
  return {
    id: event.id.slice(0, 6),
    imageName: event.from
  }
}

export function shortContainerInfoFromContainerInfo(containerInfo: ContainerInfo): ShortContainerInfo {
  return {
    id: containerInfo.Id.slice(0, 6),
    imageName: containerInfo.Image
  }
}
