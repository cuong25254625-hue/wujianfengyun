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
  { characterId: 'char_003_yagami_light' as CharacterId, name: '夜神月', visibility: 'hidden', gender: 'male', skillIds: ['chou_mou', 'cai_jue'], imageUrl: '/characters/夜神月.png', mvpImplemented: true },
  { characterId: 'char_004_holmes' as CharacterId, name: '福尔摩斯', visibility: 'public', gender: 'male', skillIds: ['zhen_xiang', 'jie_lu'], imageUrl: '/characters/福尔摩斯.png', mvpImplemented: true },
  { characterId: 'char_005_zhuge_liang' as CharacterId, name: '诸葛亮', visibility: 'public', gender: 'male', skillIds: ['qi_xing', 'ba_zhen'], imageUrl: '/characters/诸葛亮.png', mvpImplemented: true },
  { characterId: 'char_006_naruhodo' as CharacterId, name: '成步堂龙一', visibility: 'public', gender: 'male', skillIds: ['yi_yi', 'ni_zhuan'], imageUrl: '/characters/成步堂龙一.png', mvpImplemented: true },
  { characterId: 'char_007_mitsurugi_reiji' as CharacterId, name: '御剑怜侍', visibility: 'public', gender: 'male', skillIds: ['jian_shi', 'sou_cha'], imageUrl: '/characters/御剑怜侍.png', mvpImplemented: true },
  { characterId: 'char_008_jack_the_ripper' as CharacterId, name: '开膛手杰克', visibility: 'public', gender: 'male', skillIds: ['zhao_zhang', 'guan_fan'], imageUrl: '/characters/开膛手杰克.png', mvpImplemented: true },
  { characterId: 'char_009_akise_aru' as CharacterId, name: '秋濑或', visibility: 'public', gender: 'male', skillIds: ['tan_jiu', 'du_bo'], imageUrl: '/characters/秋濑或.png', mvpImplemented: true },
  { characterId: 'char_010_john_kramer' as CharacterId, name: '约翰克莱默', visibility: 'hidden', gender: 'male', skillIds: ['shu_ju', 'pin_tu'], imageUrl: '/characters/约翰克莱默.png', mvpImplemented: true },
  { characterId: 'char_011_akiyama_shinichi' as CharacterId, name: '秋山深一', visibility: 'public', gender: 'male', skillIds: ['qi_zha'], imageUrl: '/characters/秋山深一.png', mvpImplemented: true },
  { characterId: 'char_014_ayazato_chihiro' as CharacterId, name: '绫里千寻', visibility: 'public', gender: 'female', skillIds: ['bian_hu', 'ling_mei'], imageUrl: '/characters/绫里千寻.png', mvpImplemented: true },
  { characterId: 'char_015_amane_misa' as CharacterId, name: '弥海砂', visibility: 'public', gender: 'female', skillIds: ['kai_yan', 'ai_qing'], imageUrl: '/characters/弥海砂.png', mvpImplemented: true },
  { characterId: 'char_016_cc' as CharacterId, name: 'C.C', visibility: 'public', gender: 'female', skillIds: ['qi_yue', 'shou_hu'], imageUrl: '/characters/C.C.png', mvpImplemented: true },
  { characterId: 'char_017_ayanami_rei' as CharacterId, name: '绫波丽', visibility: 'public', gender: 'female', skillIds: ['bing_shan', 'ke_long'], imageUrl: '/characters/绫波丽.png', mvpImplemented: true },
  { characterId: 'char_020_gasai_yuno' as CharacterId, name: '我妻由乃', visibility: 'public', gender: 'female', skillIds: ['beng_huai', 'xin_sheng'], imageUrl: '/characters/我妻由乃.png', mvpImplemented: true },
  { characterId: 'char_021_kanzaki_nao' as CharacterId, name: '神崎直', visibility: 'public', gender: 'female', skillIds: ['cheng_dan', 'jiu_shu'], imageUrl: '/characters/神崎直.png', mvpImplemented: true },
  { characterId: 'char_022_vermouth' as CharacterId, name: '贝尔摩德', visibility: 'hidden', gender: 'female', skillIds: ['yi_rong', 'bao_mi'], imageUrl: '/characters/贝尔摩德.png', mvpImplemented: true },
  { characterId: 'char_023_kawashima_yoshiko' as CharacterId, name: '川岛芳子', visibility: 'hidden', gender: 'female', skillIds: ['jiao_ji', 'jue_qing'], imageUrl: '/characters/川岛芳子.png', mvpImplemented: true },
  { characterId: 'char_024_wei_zhongxian' as CharacterId, name: '魏忠贤', visibility: 'public', gender: 'male', skillIds: ['huan_dang', 'chang_wei'], imageUrl: '/characters/魏忠贤.png', mvpImplemented: true },
  { characterId: 'char_025_mr_and_mrs_smith' as CharacterId, name: '史密斯夫妇', visibility: 'hidden', gender: 'unknown', skillIds: ['die_zhan', 'fu_fu'], imageUrl: '/characters/史密斯夫妇.png', mvpImplemented: true },
];

export const characterDefinitionById = (characterId: CharacterId): CharacterDefinition | undefined =>
  MVP_CHARACTER_POOL.find((item) => item.characterId === characterId);

const shuffledCharacters = (): CharacterDefinition[] => {
  const items = [...MVP_CHARACTER_POOL];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex]!, items[index]!];
  }
  return items;
};

export const optionsPerPlayerFor = (playerCount: number): number =>
  Math.max(1, Math.min(2, Math.floor(MVP_CHARACTER_POOL.length / playerCount)));

export const dealCharacterOptions = (playerCount: number, optionsPerPlayer = 2): CharacterId[][] => {
  const needed = playerCount * optionsPerPlayer;
  if (needed > MVP_CHARACTER_POOL.length) throw new Error('MVP character pool is too small for private options');

  const shuffled = shuffledCharacters();
  const result: CharacterId[][] = [];
  for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
    result.push(
      shuffled
        .slice(playerIndex * optionsPerPlayer, (playerIndex + 1) * optionsPerPlayer)
        .map((character) => character.characterId),
    );
  }
  return result;
};

export const assignMvpCharacters = (playerCount: number, preferredIds: CharacterId[] = []): CharacterDefinition[] => {
  if (playerCount > MVP_CHARACTER_POOL.length) throw new Error('MVP character pool is too small');

  const assigned: CharacterDefinition[] = [];
  const used = new Set<CharacterId>();

  for (const preferredId of preferredIds) {
    const character = characterDefinitionById(preferredId);
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
