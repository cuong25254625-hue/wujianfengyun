import type { CharacterId, CharacterVisibility, Gender } from '@wujian/shared';

export interface CharacterDefinition {
  characterId: CharacterId;
  name: string;
  visibility: CharacterVisibility;
  gender: Gender;
  skillIds: string[];
  imageUrl: string;
  mvpImplemented: boolean;
}

export const MVP_CHARACTER_POOL: CharacterDefinition[] = [
  { characterId: 'char_001_chen_yong_ren' as CharacterId, name: '陈永仁', visibility: 'hidden', gender: 'male', skillIds: ['cheng_fu', 'jiu_ji'], imageUrl: '/characters/陈永仁.png', mvpImplemented: true },
  { characterId: 'char_002_liu_jian_ming' as CharacterId, name: '刘建明', visibility: 'hidden', gender: 'male', skillIds: ['cheng_fu', 'mie_ji'], imageUrl: '/characters/刘建明.png', mvpImplemented: true },
  { characterId: 'char_004_holmes' as CharacterId, name: '福尔摩斯', visibility: 'public', gender: 'male', skillIds: ['zhen_xiang', 'jie_lu'], imageUrl: '/characters/福尔摩斯.png', mvpImplemented: true },
  { characterId: 'char_006_naruhodo' as CharacterId, name: '成步堂龙一', visibility: 'public', gender: 'male', skillIds: ['yi_yi', 'ni_zhuan'], imageUrl: '/characters/成步堂龙一.png', mvpImplemented: true },
  { characterId: 'char_008_jack_the_ripper' as CharacterId, name: '开膛手杰克', visibility: 'public', gender: 'male', skillIds: ['zhao_zhang', 'guan_fan'], imageUrl: '/characters/开膛手杰克.png', mvpImplemented: true },
  { characterId: 'char_009_akise_aru' as CharacterId, name: '秋濑或', visibility: 'public', gender: 'male', skillIds: ['tan_jiu', 'du_bo'], imageUrl: '/characters/秋濑或.png', mvpImplemented: true },
  { characterId: 'char_014_ayazato_chihiro' as CharacterId, name: '绫里千寻', visibility: 'public', gender: 'female', skillIds: ['bian_hu', 'ling_mei'], imageUrl: '/characters/绫里千寻.png', mvpImplemented: true },
  { characterId: 'char_016_cc' as CharacterId, name: 'C.C', visibility: 'public', gender: 'female', skillIds: ['qi_yue', 'shou_hu'], imageUrl: '/characters/C.C.png', mvpImplemented: true },
  { characterId: 'char_017_ayanami_rei' as CharacterId, name: '绫波丽', visibility: 'public', gender: 'female', skillIds: ['bing_shan', 'ke_long'], imageUrl: '/characters/绫波丽.png', mvpImplemented: true },
  { characterId: 'char_020_gasai_yuno' as CharacterId, name: '我妻由乃', visibility: 'public', gender: 'female', skillIds: ['beng_huai', 'xin_sheng'], imageUrl: '/characters/我妻由乃.png', mvpImplemented: true },
];

export const assignMvpCharacters = (playerCount: number, preferredIds: CharacterId[] = []): CharacterDefinition[] => {
  if (playerCount > MVP_CHARACTER_POOL.length) throw new Error('MVP character pool is too small');

  const assigned: CharacterDefinition[] = [];
  const used = new Set<CharacterId>();

  for (const preferredId of preferredIds) {
    const character = MVP_CHARACTER_POOL.find((item) => item.characterId === preferredId);
    if (!character || used.has(character.characterId)) continue;
    assigned.push(character);
    used.add(character.characterId);
    if (assigned.length >= playerCount) return assigned;
  }

  for (const character of MVP_CHARACTER_POOL) {
    if (used.has(character.characterId)) continue;
    assigned.push(character);
    used.add(character.characterId);
    if (assigned.length >= playerCount) return assigned;
  }

  return assigned;
};
