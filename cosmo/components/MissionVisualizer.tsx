import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Animated, { FadeIn, SlideInRight, ZoomIn } from 'react-native-reanimated';
import { useTheme } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { BusinessTask } from '@/services/BusinessAgentService';

const { width } = Dimensions.get('window');

interface MissionVisualizerProps {
    mermaid?: string;
    tasks: BusinessTask[];
}

const ROLE_COLORS: Record<string, string> = {
    ceo: '#8b5cf6',
    research: '#3b82f6',
    analyst: '#10b981',
    developer: '#f59e0b',
    writer: '#6366f1',
    reviewer: '#f43f5e',
};

export function MissionVisualizer({ mermaid, tasks }: MissionVisualizerProps) {
    const { theme } = useTheme();

    const nodes = useMemo(() => {
        if (!mermaid) return [];
        // Support multiple Mermaid syntax variants (Goal["Label"], Goal("Label"), etc.)
        const extracted: { id: string, label: string }[] = [];
        const lines = mermaid.split('\n');
        
        lines.forEach(line => {
            const match = line.match(/(\w+)(?:\[|\["|\("|\()(.+?)(?:\)|"|")?(?:\)|"|\])/);
            if (match) {
                extracted.push({ id: match[1], label: match[2] });
            }
        });
        
        // Remove duplicates and filter empty labels
        return extracted.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
    }, [mermaid]);

    if (!nodes.length) {
        return (
            <Animated.View 
                entering={FadeIn.duration(800)} 
                style={[styles.container, { backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }]}
            >
                <Ionicons name="git-network-outline" size={32} color={theme.colors.primary} style={{ opacity: 0.2 }} />
                <Text style={[styles.title, { color: theme.colors.text, marginTop: 12, opacity: 0.4 }]}>STRATEGIZING MISSION TREE...</Text>
            </Animated.View>
        );
    }

    return (
        <Animated.View 
            entering={FadeIn.duration(800)} 
            style={[styles.container, { backgroundColor: theme.colors.surface }]}
        >
            <View style={styles.header}>
                <Ionicons name="git-network-outline" size={18} color={theme.colors.primary} />
                <Text style={[styles.title, { color: theme.colors.text }]}>MISSION STRATEGY TREE</Text>
            </View>

            <View style={styles.treeContainer}>
                {nodes.map((node, index) => {
                    const task = tasks.find(t => t.id === node.id);
                    const isGoal = node.id.toLowerCase() === 'goal';
                    const color = isGoal ? theme.colors.primary : (ROLE_COLORS[task?.assigned_to || ''] || theme.colors.secondary);
                    const isCompleted = task?.status === 'completed';

                    return (
                        <Animated.View 
                            key={node.id}
                            entering={ZoomIn.delay(index * 100).duration(500)}
                            style={[
                                styles.node, 
                                { 
                                    borderColor: color,
                                    backgroundColor: isCompleted ? color + '20' : theme.colors.background,
                                    marginLeft: isGoal ? 0 : 40,
                                }
                            ]}
                        >
                            {!isGoal && (
                                <View style={[styles.line, { backgroundColor: color }]} />
                            )}
                            <View style={[styles.nodeCircle, { backgroundColor: color }]}>
                                <Ionicons 
                                    name={isGoal ? 'flag' : 'cube'} 
                                    size={12} 
                                    color="#fff" 
                                />
                            </View>
                            <View style={styles.content}>
                                <Text 
                                    numberOfLines={1} 
                                    style={[styles.nodeLabel, { color: theme.colors.text }]}
                                >
                                    {node.label}
                                </Text>
                                {!isGoal && (
                                    <Text style={[styles.role, { color: color }]}>
                                        {task?.assigned_to?.toUpperCase()}
                                    </Text>
                                )}
                            </View>
                            {isCompleted && (
                                <Ionicons name="checkmark-circle" size={16} color="#10b981" />
                            )}
                        </Animated.View>
                    );
                })}
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        margin: 16,
        padding: 16,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.05)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.1,
        shadowRadius: 20,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
        gap: 8,
    },
    title: {
        fontSize: 10,
        fontWeight: '900',
        letterSpacing: 2,
        opacity: 0.6,
    },
    treeContainer: {
        gap: 12,
    },
    node: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 16,
        borderWidth: 1.5,
        gap: 12,
    },
    nodeCircle: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        flex: 1,
    },
    nodeLabel: {
        fontSize: 13,
        fontWeight: '600',
    },
    role: {
        fontSize: 9,
        fontWeight: '800',
        marginTop: 2,
        letterSpacing: 0.5,
    },
    line: {
        position: 'absolute',
        left: -20,
        width: 20,
        height: 2,
        opacity: 0.3,
    }
});
