/**
 * File Name: remix-aliases.ts
 * Purpose: The Ri->Icon alias mapping, kept as SOURCE OF TRUTH for
 *          scripts/generate-curated.tsx (which parses this file as text and
 *          snapshots each icon into src/curated.tsx). NOT imported at runtime
 *          - importing it would drag the 2.3MB single-file remixicon pack
 *          into every eager bundle.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends on @remixicon/react for SVG icon components. IconName is re-exported from @tangen/types to keep the canonical list framework-agnostic.
 */
// Tangen icon set — thin semantic aliases over @remixicon/react.
// Import from here instead of @remixicon/react directly so the underlying
// library can be swapped in one place.

export {
  // Navigation & arrows
  RiArrowDownLine     as IconArrowDown,
  RiArrowDownSLine    as IconChevronDown,
  RiArrowGoBackLine   as IconUndo,
  RiArrowLeftLine     as IconArrowLeft,
  RiArrowLeftSLine    as IconChevronLeft,
  RiArrowRightLine    as IconArrowRight,
  RiArrowRightSLine   as IconChevronRight,
  RiArrowUpLine       as IconArrowUp,
  RiArrowUpSLine      as IconChevronUp,

  // Actions
  RiAddLine           as IconPlus,
  RiDeleteBinLine     as IconTrash,
  RiEditLine          as IconEdit,
  RiPencilLine        as IconPencil,
  RiSaveLine          as IconSave,
  RiRefreshLine       as IconRefresh,
  RiRepeatLine        as IconRepeat,
  RiFileCopyLine      as IconCopy,
  RiUploadLine        as IconUpload,
  RiSearchLine        as IconSearch,
  RiStarLine          as IconStar,
  RiStarFill          as IconStarFill,
  RiFilterLine        as IconFilter,
  RiExternalLinkLine  as IconExternalLink,
  RiLogoutBoxLine     as IconLogout,

  // Status & feedback
  RiCheckLine         as IconCheck,
  RiCheckboxCircleLine as IconCheckCircle,
  RiCloseLine         as IconX,
  RiCloseCircleLine   as IconCloseCircle,
  RiAlertLine         as IconAlert,
  RiErrorWarningLine  as IconWarning,
  RiProhibitedLine    as IconProhibited,
  RiShieldCheckLine   as IconShieldCheck,
  RiLoader4Line       as IconLoader,
  RiLoader2Fill       as IconSpinner,

  // UI controls
  RiDraggable         as IconGripDots,
  RiDragMoveLine      as IconDragMove,
  RiExpandUpDownLine  as IconExpandUpDown,
  RiMore2Line         as IconMoreHorizontal,
  RiToggleFill        as IconToggleOn,
  RiToggleLine        as IconToggleOff,

  // Files & content
  RiFileLine          as IconFile,
  RiFileTextLine      as IconFileText,
  RiFileListLine      as IconFileList,
  RiFolderLine        as IconFolder,
  RiFolderAddLine     as IconFolderAdd,
  RiInboxLine         as IconInbox,
  RiSurveyLine        as IconSurvey,
  RiArticleLine       as IconArticle,

  // Media
  RiImageLine         as IconImage,
  RiFilmLine          as IconFilm,
  RiMusicLine         as IconMusic,

  // Code & data
  RiCodeLine          as IconCode,
  RiCodeBoxLine       as IconCodeBox,
  RiCodeSSlashLine    as IconCodeSlash,
  RiPlayCircleLine    as IconPlayCircle,
  RiPlayFill          as IconPlay,
  RiDatabase2Line     as IconDatabase,
  RiCloudLine         as IconCloud,
  RiGitBranchLine     as IconGitBranch,

  // People & org
  RiUserLine          as IconUser,
  RiUserAddLine       as IconUserAdd,
  RiTeamLine          as IconUsers,
  RiBuilding2Line     as IconBuilding,

  // Communication
  RiMailLine          as IconMail,
  RiWebhookLine       as IconWebhook,

  // Security & auth
  RiKeyLine           as IconKey,
  RiSparklingLine     as IconSparkles,
  RiKey2Line          as IconKey2,
  RiLockLine          as IconLock,
  RiLockPasswordLine  as IconLockPassword,
  RiShieldUserLine    as IconShieldUser,

  // Misc
  RiCalendarLine      as IconCalendar,
  RiTimeLine          as IconClock,
  RiHistoryLine       as IconHistory,
  RiGlobalLine        as IconGlobe,
  RiTranslate2        as IconLanguage,
  RiHome2Line         as IconHome,
  RiSettings3Line     as IconSettings,
  RiStackLine         as IconStack,
  RiListOrdered       as IconListOrdered,
  RiLayoutLeftLine    as IconLayoutLeft,
  RiComputerLine      as IconComputer,
  RiSunLine           as IconSun,
  RiMoonLine          as IconMoon,
  RiSmartphoneLine    as IconSmartphone,
  RiTabletLine        as IconTablet,
  RiListCheck3        as IconListChecks,
  RiLink              as IconLink,
  RiEyeLine           as IconEye,
  RiEyeFill           as IconEyeFill,
  RiPushpin2Line      as IconPin,
  RiEyeOffLine        as IconEyeOff,
  RiEyeOffFill        as IconEyeOffFill,

  // Extensions & analytics
  RiPuzzle2Line       as IconPuzzle,
  RiShareLine         as IconShare,
  RiBarChartLine      as IconBarChart,

  // Brands
  RiGithubLine        as IconGithub,
  RiGoogleLine        as IconGoogle,
} from '@remixicon/react'

// Re-export the base icon type so callers can type icon props without
// importing from @remixicon/react directly.
// ── Form field-type icons ─────────────────────────────────────────────────────
export {
  RiText as IconText,
  RiHashtag as IconHash,
  RiPhoneLine as IconPhone,
  RiCheckboxLine as IconCheckbox,
  RiRadioButtonLine as IconRadioButton,
  RiListUnordered as IconListUnordered,
  RiAlignLeft as IconAlignLeft,
  // Studio inspector segmented controls (Arc V) - these replace native
  // <select> for align/columns/level, where an icon reads faster than a word.
  RiAlignCenter as IconAlignCenter,
  RiAlignRight as IconAlignRight,
  RiAlignJustify as IconAlignJustify,
  RiLayoutColumnLine as IconLayoutColumn,
  RiLayoutRowLine as IconLayoutRow,
  RiLayoutGridLine as IconLayoutGrid,
  RiH1 as IconH1,
  RiH2 as IconH2,
  RiH3 as IconH3,
  RiH4 as IconH4,
  RiArrowLeftRightLine as IconArrowLeftRight,
  RiSubtractLine as IconMinus,
  RiPaletteLine as IconPalette,
  RiBrushLine as IconBrush,
  RiSmartphoneLine as IconSmartphone,
  RiTabletLine as IconTablet,
  RiComputerLine as IconComputer,
  RiExpandUpDownLine as IconSelect,
  RiTableLine as IconTable,
  RiDropdownList as IconDropdownList,
  RiAttachmentLine as IconAttachment,
  RiInformationLine as IconInfo,
  RiQuestionLine as IconQuestion,
  RiBookOpenLine as IconBookOpen,
} from '@remixicon/react'

// The full underlying Remix icon set (Ri* names) is also forwarded, so surfaces
// that let users pick from the whole library (e.g. the schema builder's icon
// picker) — and DynamicIcon rendering their choice — resolve any Ri* name, while
// the curated Icon* semantic aliases above stay the recommended in-code names.
export * from '@remixicon/react'

/**
 * Prop type shared by all Tangen icon components — mirrors RemixiconProps (SVG attrs + size + color).
 */
export type { RemixiconProps as IconProps } from '@remixicon/react'

// Re-export from @tangen/types so both import paths work.
// The canonical definition lives in @tangen/types (no React dependency there).
export type { IconName } from '@tangen/types'
