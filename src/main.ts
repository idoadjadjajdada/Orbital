import { App } from './app';
import { Hud } from './ui/hud';
import { Input } from './ui/input';
import { BeltChart } from './ui/belt';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const app = new App(canvas, document.getElementById('labels')!);
const hud = new Hud(app);
const input = new Input(app, canvas);
input.onChange = () => hud.sync();
const belt = new BeltChart(app);
const onFrame = app.onFrame;
app.onFrame = () => { onFrame(); belt.update(); };

app.loadPreset('solar');
hud.sync();
app.loop();

// handy for poking at the sim from the console, and for the browser tests
(window as unknown as { orbital: App }).orbital = app;
