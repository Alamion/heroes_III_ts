// User-facing text in English and Russian (spec 004 FR-003b, research R9). DOM-free: tools import it
// to generate host manifests. `ru` must have exactly the keys of `en` (checked by type and tests).

export const en = {
  // Settings (labels and option labels)
  setting_spritearchive: 'Sprite archive (H3sprite.lod)',
  setting_dataarchive: 'Data archive (H3bitmap.lod)',
  setting_mapfile: 'Map (.h3m)',
  setting_level: 'Level',
  level_random: 'Random',
  level_surface: 'Surface',
  level_underground: 'Underground',
  setting_viewmode: 'Starting view',
  viewmode_random: 'Random place',
  viewmode_centre: 'Map centre',
  viewmode_coords: 'Coordinates',
  setting_viewx: 'Horizontal position, %',
  setting_viewy: 'Vertical position, %',
  viewx_hint: 'Used when the starting view is "Coordinates"',
  setting_viewinterval: 'New random place every N minutes (0 = never)',
  viewinterval_hint: 'Used when the starting view is "Random place"',
  action_viewreroll: 'New random place now',
  setting_scale: 'Scale',
  scale_1: '×1 (pixel for pixel)',
  scale_2: '×2 (as in the original game)',
  scale_3: '×3',
  setting_objects: 'Show objects',
  setting_language: 'Language',
  language_auto: 'Automatic',
  language_en: 'English',
  language_ru: 'Русский',

  // File slots and kinds
  kind_spriteArchive: 'sprite archive (H3sprite.lod)',
  kind_dataArchive: 'data archive (H3bitmap.lod)',
  kind_map: 'map (.h3m)',
  kind_unknown: 'unknown file',

  // Placeholder and messages ({name} placeholders are filled by format())
  placeholder_title: 'Heroes III living map',
  placeholder_missing: 'Choose in the wallpaper settings: {files}.',
  placeholder_hint: 'The files come from your own Heroes of Might and Magic III Complete installation and never leave this computer.',
  msg_LOADING: 'Loading {file}…',
  msg_FILE_MISSING: '{file} was not found. Choose the file again.',
  msg_FILE_UNREADABLE: '{file} cannot be read: {detail}',
  msg_WRONG_KIND: '{file} is a {found}, not a {expected}.',
  msg_UNKNOWN_FILE: '{file} is not a Heroes III archive or map.',
  msg_UNSUPPORTED_MAP: '{file}: {format} maps are not supported yet.',
  msg_CORRUPT_FILE: '{file} is damaged or unsupported: {detail}',
  msg_DATA_ARCHIVE_MISSING: 'Objects are hidden: choose the data archive (H3bitmap.lod).',
  msg_WEBGL_UNAVAILABLE: 'This system cannot draw the map: WebGL is not available.',
  msg_CONTEXT_LOST: 'Graphics were reset; the map will reappear shortly.',
  msg_CACHE_UNAVAILABLE: 'Local cache is unavailable, so every start decodes the files again.',

  // Browser panel
  panel_title: 'Heroes III living map',
  panel_files: 'Files',
  panel_choose: 'Choose files…',
  panel_drop: 'or drop the two archives and a map anywhere on the page',
  panel_forget: 'Forget files',
  panel_forget_done: 'Files and cached data were removed from this browser.',
  panel_help: 'Where are the files?',
  panel_keys: 'Arrows or drag: scroll · U: level · R: new random place · O: objects · H: hide panel',
  panel_hide: 'Hide panel',
  panel_none: 'not chosen',

  // Packages and documentation
  package_title: 'H3 Living Map',
  package_description: 'An animated adventure map from your own Heroes of Might and Magic III Complete files: terrain, objects, heroes and towns, as in the original game. Fan-made, not affiliated with the game publishers. No game files are included.',
  help_files: 'Take H3sprite.lod and H3bitmap.lod from the Data folder of your Heroes III Complete installation and any map (.h3m) from its Maps folder. Maps of Restoration of Erathia, Armageddon\'s Blade and Shadow of Death are supported; HotA maps are not yet.',
  help_privacy: 'The files stay on this computer: they are read locally and never uploaded.',
  help_web: 'Choose the files with the button or drop them onto the page. The browser remembers them until you press "Forget files".',
  help_wallpaper_engine: 'Open the wallpaper properties in Wallpaper Engine and choose the three files in "Sprite archive", "Data archive" and "Map".',
  help_lively: 'Open "Customise" for the wallpaper in Lively and use "Browse" in the three file settings; Lively copies the files into the wallpaper folder.',
  help_kde: 'Install the plugin, open "Configure Desktop and Wallpaper", pick "H3 Living Map" and choose the three files.',
} as const

export type StringKey = keyof typeof en
export type Language = 'en' | 'ru'

export const ru: Record<StringKey, string> = {
  setting_spritearchive: 'Архив спрайтов (H3sprite.lod)',
  setting_dataarchive: 'Архив данных (H3bitmap.lod)',
  setting_mapfile: 'Карта (.h3m)',
  setting_level: 'Уровень',
  level_random: 'Случайный',
  level_surface: 'Поверхность',
  level_underground: 'Подземелье',
  setting_viewmode: 'Начальный вид',
  viewmode_random: 'Случайное место',
  viewmode_centre: 'Центр карты',
  viewmode_coords: 'Координаты',
  setting_viewx: 'Положение по горизонтали, %',
  setting_viewy: 'Положение по вертикали, %',
  viewx_hint: 'Используется, когда начальный вид — «Координаты»',
  setting_viewinterval: 'Новое случайное место каждые N минут (0 — никогда)',
  viewinterval_hint: 'Используется, когда начальный вид — «Случайное место»',
  action_viewreroll: 'Новое случайное место сейчас',
  setting_scale: 'Масштаб',
  scale_1: '×1 (пиксель в пиксель)',
  scale_2: '×2 (как в оригинальной игре)',
  scale_3: '×3',
  setting_objects: 'Показывать объекты',
  setting_language: 'Язык',
  language_auto: 'Автоматически',
  language_en: 'English',
  language_ru: 'Русский',

  kind_spriteArchive: 'архив спрайтов (H3sprite.lod)',
  kind_dataArchive: 'архив данных (H3bitmap.lod)',
  kind_map: 'карта (.h3m)',
  kind_unknown: 'неизвестный файл',

  placeholder_title: 'Живая карта Heroes III',
  placeholder_missing: 'Выберите в настройках обоев: {files}.',
  placeholder_hint: 'Файлы берутся из вашей установки Heroes of Might and Magic III Complete и не покидают этот компьютер.',
  msg_LOADING: 'Загрузка {file}…',
  msg_FILE_MISSING: 'Файл {file} не найден. Выберите его заново.',
  msg_FILE_UNREADABLE: 'Не удалось прочитать {file}: {detail}',
  msg_WRONG_KIND: '{file} — это {found}, а не {expected}.',
  msg_UNKNOWN_FILE: '{file} не является архивом или картой Heroes III.',
  msg_UNSUPPORTED_MAP: '{file}: карты {format} пока не поддерживаются.',
  msg_CORRUPT_FILE: 'Файл {file} повреждён или не поддерживается: {detail}',
  msg_DATA_ARCHIVE_MISSING: 'Объекты скрыты: выберите архив данных (H3bitmap.lod).',
  msg_WEBGL_UNAVAILABLE: 'Эта система не может нарисовать карту: WebGL недоступен.',
  msg_CONTEXT_LOST: 'Графика была сброшена, карта скоро появится снова.',
  msg_CACHE_UNAVAILABLE: 'Локальный кэш недоступен, поэтому при каждом запуске файлы декодируются заново.',

  panel_title: 'Живая карта Heroes III',
  panel_files: 'Файлы',
  panel_choose: 'Выбрать файлы…',
  panel_drop: 'или перетащите два архива и карту в любое место страницы',
  panel_forget: 'Забыть файлы',
  panel_forget_done: 'Файлы и кэш удалены из этого браузера.',
  panel_help: 'Где взять файлы?',
  panel_keys: 'Стрелки или перетаскивание: прокрутка · U: уровень · R: новое случайное место · O: объекты · H: скрыть панель',
  panel_hide: 'Скрыть панель',
  panel_none: 'не выбран',

  package_title: 'H3 Living Map',
  package_description: 'Анимированная карта приключений из ваших файлов Heroes of Might and Magic III Complete: местность, объекты, герои и города, как в оригинальной игре. Фанатский проект, не связан с издателями игры. Игровые файлы не входят в комплект.',
  help_files: 'Возьмите H3sprite.lod и H3bitmap.lod из папки Data вашей установки Heroes III Complete и любую карту (.h3m) из папки Maps. Поддерживаются карты Restoration of Erathia, Armageddon\'s Blade и Shadow of Death; карты HotA пока нет.',
  help_privacy: 'Файлы остаются на этом компьютере: они читаются локально и никуда не загружаются.',
  help_web: 'Выберите файлы кнопкой или перетащите их на страницу. Браузер запомнит их, пока вы не нажмёте «Забыть файлы».',
  help_wallpaper_engine: 'Откройте свойства обоев в Wallpaper Engine и выберите три файла в пунктах «Архив спрайтов», «Архив данных» и «Карта».',
  help_lively: 'Откройте «Настроить» для обоев в Lively и нажмите «Обзор» в трёх настройках файлов; Lively скопирует файлы в папку обоев.',
  help_kde: 'Установите плагин, откройте «Настроить рабочий стол и обои», выберите «H3 Living Map» и укажите три файла.',
}

export const STRINGS: Record<Language, Record<StringKey, string>> = { en, ru }

/** Russian for any `ru` tag, English otherwise. */
export function pickLanguage(tag: string | null | undefined): Language {
  return typeof tag === 'string' && /^ru(\b|[-_])/i.test(tag.trim()) ? 'ru' : 'en'
}

/** Text for a key with `{name}` placeholders filled. */
export function format(lang: Language, key: StringKey, params: Record<string, string> = {}): string {
  return STRINGS[lang][key].replace(/\{(\w+)\}/g, (m, name: string) => params[name] ?? m)
}
