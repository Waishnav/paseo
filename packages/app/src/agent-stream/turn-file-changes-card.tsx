import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { FilePenLine } from "lucide-react-native";
import { DiffStat } from "@/components/diff-stat";
import { Button } from "@/components/ui/button";
import type { Theme } from "@/styles/theme";
import type { TurnFileChangeEntry, TurnFileChangeSummary } from "./turn-file-changes";

const ThemedFilePenLine = withUnistyles(FilePenLine);
const iconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const MAX_VISIBLE_FILES = 6;

export interface TurnFileChangesCardProps {
  summary: TurnFileChangeSummary;
  onReview: () => void;
  onOpenFile?: (relativePath: string) => void;
}

function fileRowPressableStyle(state: PressableStateCallbackType): StyleProp<ViewStyle> {
  const hovered = "hovered" in state && state.hovered;
  return [stylesheet.fileRow, (state.pressed || hovered) && stylesheet.fileRowPressed];
}

export const TurnFileChangesCard = memo(function TurnFileChangesCard({
  summary,
  onReview,
  onOpenFile,
}: TurnFileChangesCardProps) {
  const { t } = useTranslation();

  const title = useMemo(() => {
    const count = summary.files.length;
    switch (summary.titleVariant) {
      case "created":
        return t("agentStream.fileChanges.createdFiles", { count });
      case "deleted":
        return t("agentStream.fileChanges.deletedFiles", { count });
      case "mixed":
        return t("agentStream.fileChanges.changedFiles", { count });
      default:
        return t("agentStream.fileChanges.editedFiles", { count });
    }
  }, [summary.files.length, summary.titleVariant, t]);

  const metadata = useMemo(() => {
    const parts: string[] = [];
    if (summary.totalAdditions > 0 || summary.totalDeletions > 0) {
      parts.push(
        t("agentStream.fileChanges.lineChanges", {
          additions: summary.totalAdditions,
          deletions: summary.totalDeletions,
        }),
      );
    }
    return parts.join(" · ");
  }, [summary.totalAdditions, summary.totalDeletions, t]);

  const visibleFiles = summary.files.slice(0, MAX_VISIBLE_FILES);
  const hiddenCount = summary.files.length - visibleFiles.length;

  const handleReview = useCallback(() => {
    onReview();
  }, [onReview]);

  return (
    <View style={stylesheet.card} testID="turn-file-changes-card">
      <View style={stylesheet.header}>
        <View style={stylesheet.headerLeading}>
          <View style={stylesheet.iconBox}>
            <ThemedFilePenLine size={14} uniProps={iconColorMapping} />
          </View>
          <View style={stylesheet.headerText}>
            <Text style={stylesheet.title}>{title}</Text>
            {metadata ? <Text style={stylesheet.metadata}>{metadata}</Text> : null}
          </View>
        </View>
        <View style={stylesheet.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onPress={handleReview}
            testID="turn-file-changes-review"
          >
            {t("agentStream.fileChanges.review")}
          </Button>
        </View>
      </View>
      <View style={stylesheet.divider} />
      <View style={stylesheet.fileList}>
        {visibleFiles.map((file) => (
          <FileChangeRow key={file.relativePath} file={file} onOpenFile={onOpenFile} />
        ))}
        {hiddenCount > 0 ? (
          <Text style={stylesheet.moreLabel}>
            {t("agentStream.fileChanges.andMore", { count: hiddenCount })}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

const FileChangeRow = memo(function FileChangeRow({
  file,
  onOpenFile,
}: {
  file: TurnFileChangeEntry;
  onOpenFile?: (relativePath: string) => void;
}) {
  const handlePress = useCallback(() => {
    onOpenFile?.(file.relativePath);
  }, [file.relativePath, onOpenFile]);

  const row = (
    <>
      <Text style={stylesheet.fileName} numberOfLines={1}>
        {file.displayName}
      </Text>
      <DiffStat additions={file.additions} deletions={file.deletions} />
    </>
  );

  if (!onOpenFile) {
    return <View style={stylesheet.fileRow}>{row}</View>;
  }

  return (
    <Pressable onPress={handlePress} accessibilityRole="button" style={fileRowPressableStyle}>
      {row}
    </Pressable>
  );
});

const stylesheet = StyleSheet.create((theme) => ({
  card: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
    backgroundColor: theme.colors.surface1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  headerLeading: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  iconBox: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  metadata: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  headerActions: {
    flexShrink: 0,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
  fileList: {
    paddingVertical: theme.spacing[1],
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    minHeight: 28,
  },
  fileRowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  fileName: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  moreLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
}));
