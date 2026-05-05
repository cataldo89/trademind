import { HeroSection } from '@/components/landing/HeroSection';
import { VisionSection } from '@/components/landing/VisionSection';
import { FeatureGrid } from '@/components/landing/FeatureGrid';

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-black overflow-hidden font-sans">
      <main className="flex-1 w-full">
        <HeroSection />
        <VisionSection />
        <FeatureGrid />
      </main>
    </div>
  );
}

# bumped: 2026-05-05T04:21:00