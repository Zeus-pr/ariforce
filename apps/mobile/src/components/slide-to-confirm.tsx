import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  LayoutChangeEvent,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { AppText } from './app-text';
import { Icon } from './icon';
import { colors, fonts } from '@/theme';

/* ══ Slide to confirm ═════════════════════════════════════
   A handle you push across a track. It follows the finger
   exactly, and past the mark it takes over and finishes the
   journey itself.

   THE HANDLE BECOMES THE ANSWER. On commit it does not hand
   over to a tick somewhere else — it unfurls leftward and
   fills the track it was crossing, and the arrow it was
   carrying becomes a check. One object changing shape, which
   is the case a morph is actually for, and the reason this
   needs no second element to say "done".

   The right edge does not move while that happens: the width
   grows by exactly what the offset loses. So the handle
   arrives, plants itself, and opens out behind it.

   Port: Bencho SlideConfirm (MIT, bencho.dev/licence). Physics
   and comments kept; DOM/CSS/framer/lucide rewritten for React
   Native (Reanimated + gesture-handler + Material icons).

   Token map (local to this root — do not leak as globals):
     --card / --fill-slab  → colors.surface
     --fill-on / --ink     → colors.ink (navy)
     --font-ui             → fonts.medium / Google Sans
     --pane-edge           → colors.separator
   `tone="canopy"` remaps fill-on → white, fill-slab → deep teal. */

const SPAN = 280;
const H = 56;
/* the inset the handle keeps from the track, all four sides */
const PAD = 4;
/* resting circular handle diameter before layout measures the track.
   After onLayout, gripSizeSV is (trackHeight - PAD*2) so the circle
   sits dead-centre in the trail (top/bottom PAD, same as the wash). */
const GRIP0 = H - PAD * 2;
/* the shortest track worth drawing. Below this the centred
   label starts to sit under the resting handle, which is the
   one collision this layout has. */
const MIN = 220;
const MAX = 380;

/* a pill, and the top of the Corner knob */
const CORNER = H / 2;
const SPEED = 50;

/* how long the finished state stands before it resets. It has
   to reset: the wall keeps one instance of a block for the
   session, so a slide that stayed confirmed would show every
   later visitor a component with nothing to do — the fault the
   Notify demo had. */
const HOLD = 1500;

function springCfg(speed: number, underdamped: boolean) {
  /* ── SPEED, and deliberately not Bounce ──────────────────
     zeta = c / (2 * sqrt(k * m)), so c at zeta 1 is
     2 * sqrt(k * m). Written that way the knob can move the
     stiffness freely and the spring stays honest. */
  const stiff = 260 + (Math.min(100, Math.max(0, speed)) / 100) * 640;
  const mass = 0.9;
  const critical = 2 * Math.sqrt(stiff * mass);
  return {
    stiffness: stiff,
    damping: underdamped ? critical * 0.62 : critical,
    mass,
  };
}

export function SlideToConfirm({
  /* the track's corner, px. The handle's is this less the
     inset, which is the concentric rule every nested pair on
     this bench follows. */
  corner = CORNER,
  /* how quickly it takes over once you let go, 0..100 */
  speed = SPEED,
  /* the track's length, px. Everything that reads as distance
     in this component — the mark, the label's fade, the
     arrow's — is a fraction of the travel rather than a fixed
     number of pixels, so all of it follows this. */
  width = SPAN,
  label = 'Slide to confirm',
  confirmedLabel = 'Confirmed',
  onConfirm,
  /** Bencho default: reset after HOLD ms. Pass false to keep filled. */
  resetAfter = HOLD,
  tone = 'default',
  style,
}: {
  corner?: number;
  speed?: number;
  width?: number;
  label?: string;
  confirmedLabel?: string;
  onConfirm?: () => void;
  resetAfter?: number | false;
  tone?: 'default' | 'canopy';
  style?: StyleProp<ViewStyle>;
}) {
  const [done, setDone] = useState(false);
  const [reduced, setReduced] = useState(false);
  const beat = useRef<ReturnType<typeof setTimeout> | null>(null);

  const span = Math.min(MAX, Math.max(MIN, Math.round(width)));
  const r = Math.min(CORNER, Math.max(0, corner));
  /* ── the handle's corner is DERIVED ──────────────────────
     `r - PAD`, floored at zero: the radius of a thing inside
     another, less the gap between them, is what keeps the two
     curves parallel. */
  const gripR = Math.max(0, r - PAD);

  const x = useSharedValue(0);
  /* ── where the handle planted itself ─────────────────────
     Zero except while it is unfurling, and then it is the
     offset the handle had when it committed. The width is
     `GRIP + (anchor - x)`, so PAD + x + width comes to
     PAD + GRIP + anchor — a number with no x in it. The right
     edge is therefore stationary BY ARITHMETIC rather than by
     two animations agreeing. */
  const anchor = useSharedValue(0);
  /* ── the settle ──────────────────────────────────────────
     A dip of about three per cent and back gives it somewhere
     to arrive. */
  const pulse = useSharedValue(1);
  /* the arrow's own fade, so it can leave on the COMMIT rather
     than on x */
  const shown = useSharedValue(1);
  const gripSizeSV = useSharedValue(GRIP0);
  const travelSV = useSharedValue(Math.max(1, span - PAD * 2 - GRIP0));
  const doneSV = useSharedValue(0);

  const grip = useRef<{ grab: number | null; moved: boolean } | null>(null);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const resetAfterRef = useRef(resetAfter);
  resetAfterRef.current = resetAfter;

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduced(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
      if (beat.current) clearTimeout(beat.current);
    };
  }, []);

  /* ── everything else is read off x ───────────────────────
     The wash behind the handle, the label giving up its ink,
     and the arrow fading as the end approaches are three
     readings of one number rather than three things animated
     toward the same moment.

     Inline Math.min/max only — calling a JS helper from a
     derived value hits the UI runtime as a remote function
     (Worklets "Tried to synchronously call a Remote Function"). */
  const seen = useDerivedValue(() => Math.min(travelSV.value, Math.max(0, x.value)));
  const wide = useDerivedValue(() => {
    const delta = Math.min(travelSV.value, Math.max(0, anchor.value - seen.value));
    return gripSizeSV.value + delta;
  });
  /* ── the overshoot becomes a SQUASH ──────────────────────
     The return spring is under-damped; position clamps and the
     energy becomes compression instead. */
  const over = useDerivedValue(() => Math.max(0, -x.value));
  const squash = useDerivedValue(() => 1 - Math.min(0.08, over.value / 110));
  const wash = useDerivedValue(() => seen.value + gripSizeSV.value);
  const say = useDerivedValue(() =>
    interpolate(seen.value, [0, travelSV.value * 0.55], [1, 0], Extrapolation.CLAMP),
  );
  const arrow = useDerivedValue(() => {
    const raw = 1 - (seen.value - travelSV.value * 0.55) / (travelSV.value * 0.4 || 1);
    const fade = Math.min(1, Math.max(0, raw));
    return shown.value * fade;
  });
  const sx = useDerivedValue(() => squash.value);
  const sy = useDerivedValue(() => 1 / squash.value);

  const commitSpring = useMemo(() => springCfg(speed, false), [speed]);
  const homeSpring = useMemo(() => springCfg(speed, true), [speed]);

  const finish = () => {
    setDone(true);
    doneSV.value = 1;
    onConfirmRef.current?.();
    /* ── x goes to ZERO, and that is the whole morph ────────
       Sending x to TRAVEL instead spilled the block: the handle
       stayed at the end AND grew to full width. */
    anchor.value = x.value;
    const flat = reducedRef.current;
    shown.value = withTiming(0, { duration: flat ? 0 : 160 });
    x.value = withSpring(0, commitSpring);
    if (!flat) {
      pulse.value = withSequence(
        withTiming(1, { duration: 100 }),
        withTiming(0.974, {
          duration: 160,
          easing: Easing.bezier(0.33, 0.55, 0.2, 1),
        }),
        withTiming(1, {
          duration: 160,
          easing: Easing.bezier(0.33, 0.55, 0.2, 1),
        }),
      );
    }
    const after = resetAfterRef.current;
    if (after === false) return;
    const hold = typeof after === 'number' ? after : HOLD;
    beat.current = setTimeout(() => {
      setDone(false);
      doneSV.value = 0;
      shown.value = withTiming(1, { duration: reducedRef.current ? 0 : 220 });
      /* and the reset is the anchor coming home with x already
         at zero: the width shrinks from the full track back to
         the handle, so the RIGHT edge sweeps left to the start. */
      anchor.value = withSpring(0, {
        stiffness: 380,
        damping: 34,
        mass: 0.9,
      });
    }, hold);
  };

  const release = () => {
    const at = x.value;
    grip.current = null;
    const mark = travelSV.value;
    if (at >= mark) finish();
    else x.value = withSpring(0, homeSpring);
  };

  const pan = Gesture.Pan()
    .runOnJS(true)
    .enabled(!done)
    .onBegin(() => {
      /* ── NO OFFSET YET, it is taken at the first MOVE ───────
         Deciding it here is what made the toggle teleport. */
      grip.current = { grab: null, moved: false };
    })
    .onUpdate((e) => {
      const g = grip.current;
      if (!g) return;
      const travel = travelSV.value;
      const at = e.x - PAD;
      if (g.grab === null) {
        g.grab = at - x.value;
        return;
      }
      const next = Math.min(travel, Math.max(0, at - g.grab));
      if (Math.abs(next - x.value) > 0.5) g.moved = true;
      x.value = next;
    })
    .onEnd(() => {
      release();
    })
    .onFinalize(() => {
      if (grip.current) release();
    });

  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
    borderRadius: r,
  }));

  const washStyle = useAnimatedStyle(() => ({
    width: wash.value,
    borderRadius: gripR,
  }));

  const sayStyle = useAnimatedStyle(() => ({
    opacity: say.value,
  }));

  const gripStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: seen.value }, { scaleX: sx.value }, { scaleY: sy.value }],
    width: wide.value,
    borderRadius: gripR,
  }));

  const arrowStyle = useAnimatedStyle(() => ({
    opacity: arrow.value,
  }));

  const doneStyle = useAnimatedStyle(() => ({
    opacity: doneSV.value,
    transform: [{ scale: doneSV.value ? 1 : 0.7 }],
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    // Size the circle from the track's inner height so it matches the
    // white wash trail (both use PAD inset on every side).
    const grip = Math.max(1, h - PAD * 2);
    gripSizeSV.value = grip;
    travelSV.value = Math.max(1, w - PAD * 2 - grip);
  };

  const canopy = tone === 'canopy';

  return (
    <View
      style={[styles.root, { width: '100%', maxWidth: MAX, minWidth: MIN, height: H }, style]}
      // Token map lives here: --fill-slab/--card → surface; --fill-on/--ink → ink
    >
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[styles.track, canopy ? styles.trackCanopy : styles.trackDefault, trackStyle]}
          onLayout={onLayout}
          accessibilityRole="adjustable"
          accessibilityLabel={done ? confirmedLabel : label}
          accessibilityState={{ disabled: done, selected: done }}
        >
          {/* the part already crossed. It is not a progress bar —
              it is the ground the handle has covered, which is why
              it ends AT the handle rather than under it.
              THE SAME INK AS THE HANDLE — turns trail into body. */}
          <Animated.View
            pointerEvents="none"
            style={[styles.wash, canopy ? styles.washCanopy : styles.washDefault, washStyle]}
          />

          <Animated.View pointerEvents="none" style={[styles.say, sayStyle]}>
            <AppText
              variant="action"
              style={[styles.sayText, canopy ? styles.sayCanopy : styles.sayDefault]}
              numberOfLines={1}
            >
              {label}
            </AppText>
          </Animated.View>

          <Animated.View
            style={[styles.grip, canopy ? styles.gripCanopy : styles.gripDefault, gripStyle]}
          >
            <Animated.View style={[styles.slot, arrowStyle]}>
              <Icon
                name="arrow-right"
                size={20}
                color={canopy ? colors.canopyDeep : colors.surface}
              />
            </Animated.View>
            <Animated.View style={[styles.slot, styles.doneRow, doneStyle]}>
              <Icon name="check" size={20} color={canopy ? colors.canopyDeep : colors.surface} />
              <AppText
                variant="action"
                style={[styles.doneText, canopy ? styles.doneCanopy : styles.doneDefault]}
                numberOfLines={1}
              >
                {confirmedLabel}
              </AppText>
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'stretch',
    // --font-ui
  },
  /* ── the track is the SLAB, the handle is the INK ───────── */
  track: {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  trackDefault: {
    // --fill-slab / --card
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator, // --pane-edge
  },
  trackCanopy: {
    backgroundColor: 'rgba(7, 89, 133, 0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  wash: {
    position: 'absolute',
    left: PAD,
    top: PAD,
    bottom: PAD,
    zIndex: 1,
  },
  washDefault: { backgroundColor: colors.ink },
  washCanopy: { backgroundColor: colors.surface },
  say: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 0,
  },
  sayText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: -0.14,
  },
  /* color-mix(fill-on 52%, fill-slab) */
  sayDefault: { color: 'rgba(15, 42, 74, 0.52)' },
  sayCanopy: { color: 'rgba(255,255,255,0.72)' },
  grip: {
    position: 'absolute',
    left: PAD,
    top: PAD,
    bottom: PAD,
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gripDefault: { backgroundColor: colors.ink },
  gripCanopy: { backgroundColor: colors.surface },
  slot: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneRow: { flexDirection: 'row', gap: 8 },
  doneText: { fontFamily: fonts.medium, fontSize: 14 },
  doneDefault: { color: colors.surface },
  doneCanopy: { color: colors.canopyDeep },
});
