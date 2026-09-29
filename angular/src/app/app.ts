import { Component, signal } from '@angular/core';
import { MyComponents } from './Components/my-components/my-components';
// import { RouterOutlet } from '@angular/router';

@Component({
  imports: [ MyComponents],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('angular');
}
