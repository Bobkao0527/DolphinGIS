/**
 * Minecraft 方塊 ID 繁體中文翻譯與顯示格式化模組（零外部相依）
 */

const EXACT_ZH_NAMES = {
  air: "空氣",
  cave_air: "洞穴空氣",
  void_air: "虛空空氣",
  stone: "石頭",
  smooth_stone: "平滑石頭",
  smooth_stone_slab: "平滑石半磚",
  cobblestone: "鵝卵石",
  mossy_cobblestone: "青苔鵝卵石",
  stone_bricks: "石磚",
  mossy_stone_bricks: "青苔石磚",
  cracked_stone_bricks: "裂紋石磚",
  chiseled_stone_bricks: "浮雕石磚",
  granite: "花崗岩",
  polished_granite: "拋光花崗岩",
  diorite: "閃長岩",
  polished_diorite: "拋光閃長岩",
  andesite: "安山岩",
  polished_andesite: "拋光安山岩",
  deepslate: "深板岩",
  cobbled_deepslate: "深板岩碎石",
  polished_deepslate: "拋光深板岩",
  deepslate_bricks: "深板岩磚",
  deepslate_tiles: "深板岩瓦",
  chiseled_deepslate: "浮雕深板岩",
  reinforced_deepslate: "強化深板岩",
  tuff: "凝灰岩",
  calcite: "方解石",
  dripstone_block: "鐘乳石方塊",
  pointed_dripstone: "鐘乳石",
  grass_block: "草地",
  dirt: "泥土",
  coarse_dirt: "粗泥",
  rooted_dirt: "扎根土",
  podzol: "灰壤",
  mycelium: "菌絲土",
  dirt_path: "土徑",
  farmland: "耕地",
  mud: "泥巴",
  packed_mud: "泥坯",
  mud_bricks: "泥磚",
  clay: "黏土",
  gravel: "礫石",
  sand: "沙子",
  red_sand: "紅沙",
  sandstone: "砂岩",
  smooth_sandstone: "平滑砂岩",
  chiseled_sandstone: "浮雕砂岩",
  cut_sandstone: "切製砂岩",
  red_sandstone: "紅砂岩",
  bedrock: "基岩",
  obsidian: "黑曜石",
  crying_obsidian: "哭泣的黑曜石",
  water: "水",
  bubble_column: "氣泡柱",
  lava: "熔岩",
  ice: "冰",
  packed_ice: "冰磚",
  blue_ice: "藍冰",
  snow_block: "雪塊",
  snow: "雪片",
  powder_snow: "粉雪",
  glass: "玻璃",
  glass_pane: "玻璃片",
  tinted_glass: "遮光玻璃",
  bricks: "紅磚",
  terracotta: "陶土",
  quartz_block: "石英方塊",
  smooth_quartz: "平滑石英",
  quartz_bricks: "石英磚",
  quartz_pillar: "石英柱",
  chiseled_quartz_block: "浮雕石英方塊",
  coal_block: "煤炭方塊",
  iron_block: "鐵方塊",
  gold_block: "金方塊",
  diamond_block: "鑽石方塊",
  emerald_block: "綠寶石方塊",
  lapis_block: "青金石方塊",
  redstone_block: "紅石方塊",
  netherite_block: "獄髓方塊",
  amethyst_block: "紫水晶方塊",
  budding_amethyst: "紫水晶母岩",
  copper_block: "銅方塊",
  exposed_copper: "斑駁銅方塊",
  weathered_copper: "風化銅方塊",
  oxidized_copper: "氧化銅方塊",
  cut_copper: "切製銅方塊",
  coal_ore: "煤礦",
  deepslate_coal_ore: "深板岩煤礦",
  iron_ore: "鐵礦",
  deepslate_iron_ore: "深板岩鐵礦",
  copper_ore: "銅礦",
  deepslate_copper_ore: "深板岩銅礦",
  gold_ore: "金礦",
  deepslate_gold_ore: "深板岩金礦",
  redstone_ore: "紅石礦",
  deepslate_redstone_ore: "深板岩紅石礦",
  lapis_ore: "青金石礦",
  deepslate_lapis_ore: "深板岩青金石礦",
  diamond_ore: "鑽石礦",
  deepslate_diamond_ore: "深板岩鑽石礦",
  emerald_ore: "綠寶石礦",
  deepslate_emerald_ore: "深板岩綠寶石礦",
  nether_gold_ore: "地獄金礦",
  nether_quartz_ore: "地獄石英礦",
  ancient_debris: "遠古遺骸",
  glowstone: "螢光石",
  sea_lantern: "海燈籠",
  redstone_lamp: "紅石燈",
  shroomlight: "菌光體",
  ochre_froglight: "赭黃蛙光燈",
  pearlescent_froglight: "珠光蛙光燈",
  verdant_froglight: "翠綠蛙光燈",
  jack_o_lantern: "南瓜燈",
  lantern: "燈籠",
  soul_lantern: "靈魂燈籠",
  torch: "火把",
  wall_torch: "牆上火把",
  soul_torch: "靈魂火把",
  end_rod: "終界燭",
  beacon: "烽火台",
  magma_block: "岩漿塊",
  moss_block: "青苔方塊",
  moss_carpet: "青苔地毯",
  vine: "藤蔓",
  rail: "鐵軌",
  powered_rail: "動力鐵軌",
  detector_rail: "感壓鐵軌",
  activator_rail: "觸發鐵軌",
  redstone_wire: "紅石線",
  repeater: "紅石中繼器",
  comparator: "紅石比較器",
  lever: "拉桿",
  piston: "活塞",
  sticky_piston: "黏性活塞",
  observer: "偵測器",
  dispenser: "發射器",
  dropper: "投擲器",
  hopper: "漏斗",
  chest: "儲物箱",
  trapped_chest: "陷阱儲物箱",
  ender_chest: "終界箱",
  barrel: "木桶",
  furnace: "熔爐",
  blast_furnace: "高爐",
  smoker: "煙燻爐",
  crafting_table: "工作台",
  enchanting_table: "附魔台",
  anvil: "鐵砧",
  bookshelf: "書櫃",
  lectern: "講台",
  ladder: "梯子",
  scaffolding: "鷹架",
  bell: "鐘",
  netherrack: "地獄石",
  nether_bricks: "地獄磚",
  red_nether_bricks: "紅地獄磚",
  crimson_nylium: "緋紅菌絲石",
  warped_nylium: "扭曲菌絲石",
  nether_wart_block: "地獄疙瘩塊",
  warped_wart_block: "扭曲疙瘩塊",
  soul_sand: "靈魂砂",
  soul_soil: "靈魂土",
  basalt: "玄武岩",
  polished_basalt: "拋光玄武岩",
  smooth_basalt: "平滑玄武岩",
  blackstone: "黑石",
  polished_blackstone: "拋光黑石",
  polished_blackstone_bricks: "拋光黑石磚",
  end_stone: "終界石",
  end_stone_bricks: "終界石磚",
  purpur_block: "紫珀方塊",
  purpur_pillar: "紫珀柱",
  chorus_plant: "歌萊枝",
  chorus_flower: "歌萊花",
  end_portal_frame: "終界傳送門框架",
  prismarine: "海磷石",
  prismarine_bricks: "海磷石磚",
  dark_prismarine: "暗海磷石",
  sponge: "海綿",
  wet_sponge: "濕海綿",
  tnt: "TNT",
  barrier: "屏障",
  command_block: "指令方塊",
  repeating_command_block: "重複型指令方塊",
  chain_command_block: "連鎖型指令方塊",
  iron_bars: "鐵欄杆",
  chain: "鐵鍊",
  flower_pot: "花盆",
  hay_block: "乾草捆",
  melon: "西瓜",
  pumpkin: "南瓜",
  carved_pumpkin: "雕刻南瓜",
  cactus: "仙人掌",
  sugar_cane: "甘蔗",
  bamboo: "竹子",
  kelp: "海帶",
  seagrass: "海草",
  tall_seagrass: "高海草",
  short_grass: "草",
  tall_grass: "芒草",
  fern: "蕨",
  dead_bush: "枯灌木",
  azalea: "杜鵑叢",
  flowering_azalea: "開花的杜鵑叢",
  oak_leaves: "橡木樹葉",
  spruce_leaves: "杉木樹葉",
  birch_leaves: "樺木樹葉",
  jungle_leaves: "叢林木樹葉",
  acacia_leaves: "相思木樹葉",
  dark_oak_leaves: "黑橡木樹葉",
  mangrove_leaves: "紅樹林木樹葉",
  cherry_leaves: "櫻花木樹葉",
  pale_oak_leaves: "蒼白橡木樹葉",
  azalea_leaves: "杜鵑葉",
  flowering_azalea_leaves: "開花的杜鵑葉",
};

const COLOR_PREFIXES = [
  ["light_gray", "淺灰色"],
  ["light_blue", "淺藍色"],
  ["white", "白色"],
  ["gray", "灰色"],
  ["black", "黑色"],
  ["brown", "棕色"],
  ["red", "紅色"],
  ["orange", "橙色"],
  ["yellow", "黃色"],
  ["lime", "淺綠色"],
  ["green", "綠色"],
  ["cyan", "青色"],
  ["blue", "藍色"],
  ["purple", "紫色"],
  ["magenta", "洋紅色"],
  ["pink", "粉紅色"],
];

const WOOD_PREFIXES = [
  ["dark_oak", "黑橡木"],
  ["pale_oak", "蒼白橡木"],
  ["oak", "橡木"],
  ["spruce", "杉木"],
  ["birch", "樺木"],
  ["jungle", "叢林木"],
  ["acacia", "相思木"],
  ["mangrove", "紅樹林木"],
  ["cherry", "櫻花木"],
  ["bamboo", "竹"],
  ["crimson", "緋紅蕈木"],
  ["warped", "扭曲蕈木"],
];

const COLORED_SUFFIXES = [
  ["_concrete_powder", "混凝土粉末"],
  ["_concrete", "混凝土"],
  ["_glazed_terracotta", "釉陶"],
  ["_terracotta", "陶土"],
  ["_stained_glass_pane", "染色玻璃片"],
  ["_stained_glass", "染色玻璃"],
  ["_wool", "羊毛"],
  ["_carpet", "地毯"],
  ["_shulker_box", "界伏盒"],
  ["_bed", "床"],
  ["_wall_banner", "牆上旗幟"],
  ["_banner", "旗幟"],
  ["_candle", "蠟燭"],
];

const WOOD_SUFFIXES = [
  ["_planks", "木材"],
  ["_log", "原木"],
  ["_wood", "木塊"],
  ["_stem", "菌柄"],
  ["_hyphae", "菌絲體"],
  ["_leaves", "樹葉"],
  ["_stairs", "階梯"],
  ["_slab", "半磚"],
  ["_fence_gate", "柵欄門"],
  ["_fence", "柵欄"],
  ["_trapdoor", "活板門"],
  ["_door", "門"],
  ["_pressure_plate", "壓力板"],
  ["_button", "按鈕"],
  ["_wall_hanging_sign", "牆上懸掛式告示牌"],
  ["_hanging_sign", "懸掛式告示牌"],
  ["_wall_sign", "牆上告示牌"],
  ["_sign", "告示牌"],
];

const MATERIAL_PREFIXES = [
  ["polished_blackstone_brick", "拋光黑石磚"],
  ["polished_blackstone", "拋光黑石"],
  ["polished_deepslate", "拋光深板岩"],
  ["cobbled_deepslate", "深板岩碎石"],
  ["deepslate_brick", "深板岩磚"],
  ["deepslate_tile", "深板岩瓦"],
  ["smooth_sandstone", "平滑砂岩"],
  ["smooth_red_sandstone", "平滑紅砂岩"],
  ["smooth_quartz", "平滑石英"],
  ["mossy_stone_brick", "青苔石磚"],
  ["mossy_cobblestone", "青苔鵝卵石"],
  ["stone_brick", "石磚"],
  ["red_nether_brick", "紅地獄磚"],
  ["nether_brick", "地獄磚"],
  ["end_stone_brick", "終界石磚"],
  ["dark_prismarine", "暗海磷石"],
  ["prismarine_brick", "海磷石磚"],
  ["mud_brick", "泥磚"],
  ["cobblestone", "鵝卵石"],
  ["blackstone", "黑石"],
  ["deepslate", "深板岩"],
  ["sandstone", "砂岩"],
  ["red_sandstone", "紅砂岩"],
  ["prismarine", "海磷石"],
  ["andesite", "安山岩"],
  ["polished_andesite", "拋光安山岩"],
  ["diorite", "閃長岩"],
  ["polished_diorite", "拋光閃長岩"],
  ["granite", "花崗岩"],
  ["polished_granite", "拋光花崗岩"],
  ["quartz", "石英"],
  ["purpur", "紫珀"],
  ["copper", "銅"],
  ["brick", "紅磚"],
  ["stone", "石"],
  ["iron", "鐵"],
  ["tuff", "凝灰岩"],
];

const SHAPE_SUFFIXES = [
  ["_stairs", "階梯"],
  ["_slab", "半磚"],
  ["_wall", "牆"],
  ["_fence", "柵欄"],
  ["_trapdoor", "活板門"],
  ["_door", "門"],
  ["_bars", "欄杆"],
];

/**
 * 去除 namespace 前綴（例如 minecraft:stone -> stone）
 */
export function getBlockShortId(blockId) {
  if (!blockId) return "";
  return String(blockId).replace(/^minecraft:/, "");
}

/**
 * 依方塊 ID 推論繁體中文名稱，查無明確對照則回傳精簡 ID
 */
export function getBlockChineseName(blockId) {
  const short = getBlockShortId(blockId);
  if (!short) return "";
  if (EXACT_ZH_NAMES[short]) return EXACT_ZH_NAMES[short];

  for (const [suffix, zhSuffix] of COLORED_SUFFIXES) {
    if (short.endsWith(suffix)) {
      const prefix = short.slice(0, -suffix.length);
      for (const [cKey, cZh] of COLOR_PREFIXES) {
        if (prefix === cKey) return `${cZh}${zhSuffix}`;
      }
    }
  }

  let body = short;
  let stripped = false;
  if (body.startsWith("stripped_")) {
    body = body.slice("stripped_".length);
    stripped = true;
  }
  for (const [suffix, zhSuffix] of WOOD_SUFFIXES) {
    if (body.endsWith(suffix)) {
      const prefix = body.slice(0, -suffix.length);
      for (const [wKey, wZh] of WOOD_PREFIXES) {
        if (prefix === wKey) {
          return `${stripped ? "去皮" : ""}${wZh}${zhSuffix}`;
        }
      }
    }
  }

  for (const [suffix, zhSuffix] of SHAPE_SUFFIXES) {
    if (short.endsWith(suffix)) {
      const prefix = short.slice(0, -suffix.length);
      for (const [mKey, mZh] of MATERIAL_PREFIXES) {
        if (prefix === mKey) return `${mZh}${zhSuffix}`;
      }
    }
  }

  return short;
}

/**
 * 組合顯示文字：「繁體中文名稱 (short_id)」
 */
export function formatBlockDisplayName(blockId) {
  const short = getBlockShortId(blockId);
  if (!short) return "未知方塊";
  const zh = getBlockChineseName(short);
  return zh && zh !== short ? `${zh} (${short})` : short;
}
