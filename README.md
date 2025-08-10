Interactive 3D Rubik's Cube

This is a comprehensive, browser-based 3D Rubik's Cube simulator built with Three.js. It offers a highly performant and interactive experience, allowing users to manipulate cubes of various sizes, from the standard 3x3x3 up to a challenging 20x20x20. The application is designed for both casual cubers and enthusiasts, featuring a rich set of controls, state management, and performance optimizations.

Key Features
Configurable Cube Size (N x N x N): Dynamically generate and interact with cubes of any size from 2x2x2 to 20x20x20.

Performant 3D Rendering: Utilizes InstancedMesh for efficient rendering, ensuring smooth performance even with a large number of individual cubies.

Interactive Controls:

Mouse: Intuitive click-and-drag to rotate layers.

UI Buttons: Standard Singmaster notation buttons (U, D, L, R, F, B, and their inverses) for precise moves.

Keyboard: Full keyboard support for all standard face moves.

Smooth Animations: All moves are animated smoothly using quaternion-based rotations for a fluid visual experience. Animation speed is adjustable.

Full State Management:

Undo/Redo: Step backward and forward through your move history.

Scramble: Instantly randomize the cube with a sequence of moves.

Solve: Animate the exact inverse of the recorded move history to return the cube to its solved state.

History Tracking: A dedicated panel displays the complete sequence of moves made.

Export/Import State: Save the current state of your cube (including its size and sticker configuration) to a JSON file and import it later to continue.

Accessibility: A color-blind mode adds distinct symbols to each face for better color differentiation.

Performance: Optimized with BufferGeometry, instancing, and an adjustable device pixel ratio to run smoothly on various devices.

How to Use
1. Camera Controls
Rotate View: Click and drag with the left mouse button anywhere in the background.

Zoom: Use the mouse scroll wheel.

Pan/Move: Click and drag with the right mouse button.

2. Making Moves
You have three primary ways to rotate the cube's layers:

UI Buttons: On the left panel, click any of the buttons labeled with standard move notation (e.g., U for Up, D' for Down counter-clockwise).

Mouse Drag:

Click and hold the left mouse button on a specific cubie.

Drag the mouse in the direction you want to rotate the layer.

Release the mouse button to complete the move.

Keyboard Shortcuts:

Clockwise: U, D, L, R, F, B

Counter-Clockwise: Hold Shift and press the corresponding key (e.g., Shift + U for U').

3. Main Actions
The action buttons are located in the left panel:

Build: After changing the number in the Size (N) input at the top, click this to generate a new cube of that dimension.

Scramble: Applies a series of random moves to the cube.

Solve: This button will not magically solve the cube from any state. Instead, it reverses the move history step-by-step, animating each inverse move until it returns to the state it was in before the first recorded move.

Undo/Redo: Use these to step through your session's move history.

4. Settings & State
Move Speed: The slider on the left panel controls the duration of the move animations.

Color-Blind Markers: Toggle the checkbox to show or hide symbols on the faces.

Export JSON: Found in the right panel, this button downloads a .json file containing the complete state of your current cube.

Import JSON: Click this to open a file dialog. Select a previously exported state file to load it into the simulator.

Technical Overview
This application leverages the power of Three.js for 3D rendering in the browser.

Rendering: To handle potentially thousands of cubies in larger puzzles without performance degradation, the cube is rendered using a single THREE.InstancedMesh. This is far more efficient than rendering each cubie as a separate Mesh object.

Logical State: The cube's state (the position and orientation of each cubie) is maintained in a logical 3D array. This array is updated instantly when a move is made.

Animation: Rotations are handled mathematically using Quaternions to avoid issues like gimbal lock and to allow for smooth, spherical interpolation between the start and end states of a move.

Move History: The move history is stored as a list of permutation operations, making undo, redo, and the "solve" (reverse history) features straightforward to implement.
